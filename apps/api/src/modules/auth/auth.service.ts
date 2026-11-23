import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
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

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const createSlug = (name: string): string =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)}-${randomBytes(3).toString("hex")}`;

type ClientMetadata = { userAgent?: string; ipAddress?: string };

const issueAccessToken = (user: { id: string; email: string }, organizationId: string, role: string) =>
  jwt.sign(
    { email: user.email, organizationId, role },
    requiredSecret("JWT_ACCESS_SECRET"),
    { subject: user.id, expiresIn: ACCESS_TTL_SECONDS },
  );

const createRefreshSession = async (userId: string, metadata: ClientMetadata) => {
  const refreshToken = randomBytes(48).toString("base64url");
  const tokenHash = hashToken(refreshToken);
  await RefreshSession.create({
    userId,
    tokenHash,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    userAgent: metadata.userAgent,
    ipAddress: metadata.ipAddress,
  });
  return refreshToken;
};

const getSessionContext = async (userId: string) => {
  const membership = await Membership.findOne({ userId, status: "active" }).sort({ createdAt: 1 });
  if (!membership) throw new HttpError(403, "No active organization membership was found");
  return { organizationId: membership.organizationId.toString(), role: membership.role };
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
    const refreshToken = await createRefreshSession(user.id, metadata);
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
  const refreshToken = await createRefreshSession(user.id, metadata);
  user.lastLoginAt = new Date();
  await user.save();
  return {
    accessToken: issueAccessToken({ id: user.id, email: user.email }, context.organizationId, context.role),
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email },
    organization: context,
  };
};

export const refresh = async (token: string, metadata: ClientMetadata) => {
  const tokenHash = hashToken(token);
  const session = await RefreshSession.findOneAndUpdate(
    { tokenHash, revokedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { revokedAt: new Date() } },
    { new: false },
  );
  if (!session) throw new HttpError(401, "Refresh session is invalid or expired");

  const user = await User.findById(session.userId);
  if (!user || user.status !== "active") throw new HttpError(401, "Account is unavailable");
  const context = await getSessionContext(user.id);
  const nextRefreshToken = await createRefreshSession(user.id, metadata);
  await RefreshSession.updateOne(
    { _id: session._id },
    { $set: { replacedByTokenHash: hashToken(nextRefreshToken) } },
  );
  return {
    accessToken: issueAccessToken({ id: user.id, email: user.email }, context.organizationId, context.role),
    refreshToken: nextRefreshToken,
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

export const getCurrentUser = async (userId: string) => {
  const user = await User.findById(userId).select("name email status createdAt");
  if (!user) throw new HttpError(404, "User not found");
  const membership = await Membership.findOne({ userId, status: "active" })
    .populate("organizationId", "name slug status");
  if (!membership || !membership.organizationId) throw new HttpError(403, "No active organization membership");
  const organization = membership.organizationId as unknown as { id: string; name: string; slug: string; status: string };
  return {
    user: { id: user.id, name: user.name, email: user.email, status: user.status },
    organization: { id: organization.id, name: organization.name, slug: organization.slug, role: membership.role },
  };
};

export const verifyAccessToken = (token: string) =>
  jwt.verify(token, requiredSecret("JWT_ACCESS_SECRET"));
