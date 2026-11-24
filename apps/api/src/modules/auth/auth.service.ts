import { randomBytes, randomUUID, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose, { type ClientSession } from "mongoose";
import { User } from "../users/user.model.js";
import { Organization } from "../organizations/organization.model.js";
import { Membership } from "../organizations/membership.model.js";
import { RefreshSession } from "./refresh-session.model.js";
import { HttpError } from "../../common/http-error.js";
import type { LoginInput, RegisterInput } from "./auth.schemas.js";

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const requiredSecret = (key: "JWT_ACCESS_SECRET"): string => {
  const value = process.env[key];
  if (!value || value.length < 32) throw new Error(`${key} must be configured with at least 32 characters`);
  return value;
};

// Store refresh-token fingerprints rather than reusable plaintext bearer credentials.
const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const createSlug = (name: string): string =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)}-${randomBytes(3).toString("hex")}`;

type ClientMetadata = { userAgent?: string; ipAddress?: string };
type SessionContext = { organizationId: string; role: string; name: string; slug: string };

const issueAccessToken = (user: { id: string; email: string }, organizationId: string, role: string) =>
  jwt.sign(
    { email: user.email, organizationId, role },
    requiredSecret("JWT_ACCESS_SECRET"),
    { subject: user.id, expiresIn: ACCESS_TTL_SECONDS },
  );

const createRefreshSession = async (userId: string, organizationId: string, metadata: ClientMetadata, familyId = randomUUID(), session?: ClientSession) => {
  const refreshToken = randomBytes(48).toString("base64url");
  const tokenHash = hashToken(refreshToken);
  await RefreshSession.create([{
    userId,
    organizationId,
    familyId,
    tokenHash,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    userAgent: metadata.userAgent,
    ipAddress: metadata.ipAddress,
  }], session ? { session } : {});
  return refreshToken;
};

const getSessionContext = async (userId: string, organizationId?: string, session?: ClientSession): Promise<SessionContext> => {
  let membershipQuery = Membership.find({
    userId,
    status: "active",
    ...(organizationId ? { organizationId } : {}),
  }).sort({ createdAt: 1 });
  if (session) membershipQuery = membershipQuery.session(session);
  const memberships = await membershipQuery.lean();
  if (!memberships.length) throw new HttpError(403, "No active organization membership was found");

  let organizationQuery = Organization.find({
    _id: { $in: memberships.map((membership) => membership.organizationId) },
    status: "active",
  }).select("_id name slug");
  if (session) organizationQuery = organizationQuery.session(session);
  const organizations = await organizationQuery.lean();
  const organizationById = new Map(organizations.map((organization) => [String(organization._id), organization]));
  const membership = memberships.find((item) => organizationById.has(String(item.organizationId)));
  if (!membership) throw new HttpError(403, "No active organization membership was found");
  const organization = organizationById.get(String(membership.organizationId))!;
  return {
    organizationId: String(organization._id),
    role: membership.role,
    name: organization.name,
    slug: organization.slug,
  };
};

export const register = async (input: RegisterInput, metadata: ClientMetadata) => {
  const email = input.email.toLowerCase().trim();
  if (await User.exists({ email })) throw new HttpError(409, "An account with this email already exists");

  const passwordHash = await bcrypt.hash(input.password, 12);
  let createdUserId: string | undefined;
  let createdOrganizationId: string | undefined;

  try {
    const user = await User.create({ name: input.name, email, passwordHash });
    createdUserId = user.id;
    const organization = await Organization.create({
      name: input.organizationName,
      slug: createSlug(input.organizationName),
      createdBy: user._id,
    });
    createdOrganizationId = organization.id;
    await Membership.create({
      userId: user._id,
      organizationId: organization._id,
      role: "owner",
      status: "active",
    });
    const refreshToken = await createRefreshSession(user.id, organization.id, metadata);
    const accessToken = issueAccessToken({ id: user.id, email: user.email }, organization.id, "owner");
    return {
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email },
      organization: { id: organization.id, name: organization.name, role: "owner" },
    };
  } catch (error) {
    if (createdOrganizationId) await Organization.findByIdAndDelete(createdOrganizationId);
    if (createdUserId) {
      await Membership.deleteMany({ userId: createdUserId });
      await RefreshSession.deleteMany({ userId: createdUserId });
      await User.findByIdAndDelete(createdUserId);
    }
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      throw new HttpError(409, "An account with this email already exists");
    }
    throw error;
  }
};

export const login = async (input: LoginInput, metadata: ClientMetadata) => {
  const email = input.email.toLowerCase().trim();
  const user = await User.findOne({ email }).select("+passwordHash");
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new HttpError(401, "Invalid email or password");
  }
  if (user.status !== "active") throw new HttpError(403, "This account is not active");

  const context = await getSessionContext(user.id);
  const refreshToken = await createRefreshSession(user.id, context.organizationId, metadata);
  user.lastLoginAt = new Date();
  await user.save();
  return {
    accessToken: issueAccessToken({ id: user.id, email: user.email }, context.organizationId, context.role),
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email },
    organization: context,
  };
};

type RotationResult =
  | { status: "rotated"; refreshToken: string; accessToken: string; organization: SessionContext }
  | { status: "reused" | "invalid" };

const rotateSession = async (
  token: string,
  metadata: ClientMetadata,
  expectedUserId?: string,
  targetOrganizationId?: string,
): Promise<RotationResult> => {
  const tokenHash = hashToken(token);
  let outcome: RotationResult = { status: "invalid" };

  await mongoose.connection.transaction(async (transaction) => {
    const existing = await RefreshSession.findOne({ tokenHash }).session(transaction);
    if (!existing) return;

    if (existing.revokedAt) {
      if (existing.replacedByTokenHash) {
        const familyFilter = existing.familyId
          ? { familyId: existing.familyId }
          : { userId: existing.userId };
        await RefreshSession.updateMany(
          { ...familyFilter, revokedAt: null },
          { $set: { revokedAt: new Date() } },
          { session: transaction },
        );
        outcome = { status: "reused" };
      }
      return;
    }
    if (existing.expiresAt <= new Date() || (expectedUserId && String(existing.userId) !== expectedUserId)) return;

    const user = await User.findOne({ _id: existing.userId, status: "active" }).session(transaction);
    if (!user) return;
    let organization: SessionContext;
    if (targetOrganizationId) {
      organization = await getSessionContext(user.id, targetOrganizationId, transaction);
    } else if (existing.organizationId) {
      try {
        organization = await getSessionContext(user.id, existing.organizationId.toString(), transaction);
      } catch {
        // A tenant may have been suspended since the last refresh. Preserve
        // account recovery by moving the session to another active membership.
        organization = await getSessionContext(user.id);
      }
    } else {
      organization = await getSessionContext(user.id);
    }
    const familyId = existing.familyId || randomUUID();
    const nextRefreshToken = randomBytes(48).toString("base64url");
    const nextTokenHash = hashToken(nextRefreshToken);

    existing.revokedAt = new Date();
    existing.replacedByTokenHash = nextTokenHash;
    existing.familyId = familyId;
    existing.organizationId = new mongoose.Types.ObjectId(organization.organizationId);
    await existing.save({ session: transaction });
    await RefreshSession.create([{
      userId: user._id,
      organizationId: organization.organizationId,
      familyId,
      tokenHash: nextTokenHash,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      userAgent: metadata.userAgent,
      ipAddress: metadata.ipAddress,
    }], { session: transaction });

    outcome = {
      status: "rotated",
      refreshToken: nextRefreshToken,
      accessToken: issueAccessToken({ id: user.id, email: user.email }, organization.organizationId, organization.role),
      organization,
    };
  }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });

  return outcome;
};

const assertRotationSucceeded = (result: RotationResult) => {
  if (result.status === "reused") throw new HttpError(401, "Refresh token reuse detected; this session family has been revoked");
  if (result.status !== "rotated") throw new HttpError(401, "Refresh session is invalid or expired");
  return result;
};

export const refresh = async (token: string, metadata: ClientMetadata) => {
  return assertRotationSucceeded(await rotateSession(token, metadata));
};

export const switchOrganization = async (
  userId: string,
  organizationId: string,
  token: string,
  metadata: ClientMetadata,
) => {
  if (!mongoose.isValidObjectId(organizationId)) throw new HttpError(404, "Organization not found");
  const result = assertRotationSucceeded(await rotateSession(token, metadata, userId, organizationId));
  return {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    organization: {
      id: result.organization.organizationId,
      name: result.organization.name,
      slug: result.organization.slug,
      role: result.organization.role,
    },
  };
};

export const logout = async (token?: string) => {
  if (token) {
    await RefreshSession.updateOne(
      { tokenHash: hashToken(token), revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  }
};

export const listUserOrganizations = async (userId: string) => {
  const memberships = await Membership.find({ userId, status: "active" }).sort({ createdAt: 1 }).lean();
  const organizations = await Organization.find({
    _id: { $in: memberships.map((membership) => membership.organizationId) },
    status: "active",
  }).select("_id name slug").lean();
  const organizationById = new Map(organizations.map((organization) => [String(organization._id), organization]));
  return memberships.flatMap((membership) => {
    const organization = organizationById.get(String(membership.organizationId));
    return organization ? [{
      id: String(organization._id),
      name: organization.name,
      slug: organization.slug,
      role: membership.role,
    }] : [];
  });
};

export const getCurrentUser = async (userId: string, organizationId: string) => {
  const user = await User.findById(userId).select("name email status createdAt");
  if (!user) throw new HttpError(404, "User not found");
  const membership = await Membership.findOne({ userId, organizationId, status: "active" });
  if (!membership) throw new HttpError(403, "No active organization membership");
  const organization = await Organization.findOne({ _id: organizationId, status: "active" }).select("name slug");
  if (!organization) throw new HttpError(403, "Organization is not active");
  return {
    user: { id: user.id, name: user.name, email: user.email, status: user.status },
    organization: { id: organization.id, name: organization.name, slug: organization.slug, role: membership.role },
  };
};

export const verifyAccessToken = (token: string) =>
  jwt.verify(token, requiredSecret("JWT_ACCESS_SECRET"));
