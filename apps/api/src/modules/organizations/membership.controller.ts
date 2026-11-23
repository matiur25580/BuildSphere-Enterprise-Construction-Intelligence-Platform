import type { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../../common/async-handler.js";
import { HttpError } from "../../common/http-error.js";
import { Membership } from "./membership.model.js";
import { Organization } from "./organization.model.js";
import { User } from "../users/user.model.js";
import { getCollaborationTransactionStatus } from "../collaboration/collaboration.service.js";
import { addOrganizationMemberSchema, updateOrganizationMemberSchema } from "./membership.schemas.js";

const context = (request: Request) => {
  if (!request.auth) throw new HttpError(401, "Authentication required");
  return request.auth;
};
const assertTransactionSupport = () => {
  if (getCollaborationTransactionStatus() !== "enabled") {
    throw new HttpError(503, "Organization membership administration requires MongoDB replica-set or sharded-cluster transactions");
  }
};
const canManageElevatedRole = (actorRole: string, targetRole?: string, nextRole?: string) => {
  if (actorRole === "owner") return;
  if (actorRole !== "admin" || targetRole === "owner" || targetRole === "admin" || nextRole === "owner" || nextRole === "admin") {
    throw new HttpError(403, "Only organization owners can manage owners or administrators");
  }
};

export const listOrganizationMembers = asyncHandler(async (request: Request, response: Response) => {
  const auth = context(request);
  const members = await Membership.find({ organizationId: auth.organizationId })
    .populate("userId", "name email status lastLoginAt")
    .sort({ role: 1, createdAt: 1 }).lean();
  response.json({ success: true, data: members });
});

export const addOrganizationMember = asyncHandler(async (request: Request, response: Response) => {
  const auth = context(request);
  assertTransactionSupport();
  const input = addOrganizationMemberSchema.parse(request.body);
  canManageElevatedRole(auth.role, undefined, input.role);
  const user = await User.findOne({ email: input.email, status: "active" }).select("_id name email");
  if (!user) throw new HttpError(404, "An active BuildSphere account with this email was not found");
  let created;
  await mongoose.connection.transaction(async (session) => {
    await Organization.updateOne({ _id: auth.organizationId }, { $inc: { membershipRevision: 1 } }, { session });
    const existing = await Membership.findOne({ organizationId: auth.organizationId, userId: user._id }).session(session);
    if (existing?.status === "active") throw new HttpError(409, "This user is already an active organization member");
    if (existing) {
      existing.role = input.role;
      existing.status = "active";
      await existing.save({ session });
      created = existing;
    } else {
      [created] = await Membership.create([{ organizationId: auth.organizationId, userId: user._id, role: input.role, status: "active" }], { session });
    }
  }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  const result = await Membership.findById(created?._id).populate("userId", "name email status lastLoginAt");
  response.status(201).json({ success: true, data: result });
});

export const updateOrganizationMember = asyncHandler(async (request: Request, response: Response) => {
  const auth = context(request);
  assertTransactionSupport();
  const memberId = String(request.params.memberId);
  if (!mongoose.isValidObjectId(memberId)) throw new HttpError(404, "Organization member not found");
  const input = updateOrganizationMemberSchema.parse(request.body);
  let updatedId: mongoose.Types.ObjectId | undefined;
  await mongoose.connection.transaction(async (session) => {
    const organization = await Organization.findOneAndUpdate(
      { _id: auth.organizationId }, { $inc: { membershipRevision: 1 } }, { new: true, session },
    );
    if (!organization) throw new HttpError(404, "Organization not found");
    const member = await Membership.findOne({ _id: memberId, organizationId: auth.organizationId }).session(session);
    if (!member) throw new HttpError(404, "Organization member not found");
    canManageElevatedRole(auth.role, member.role, input.role);
    const nextRole = input.role ?? member.role;
    const nextStatus = input.status ?? member.status;
    if (member.role === "owner" && (nextRole !== "owner" || nextStatus !== "active")) {
      const activeOwners = await Membership.countDocuments({ organizationId: auth.organizationId, role: "owner", status: "active" }).session(session);
      if (activeOwners <= 1) throw new HttpError(409, "An organization must retain at least one active owner");
    }
    member.role = nextRole;
    member.status = nextStatus;
    await member.save({ session });
    updatedId = member._id;
  }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  const result = await Membership.findById(updatedId).populate("userId", "name email status lastLoginAt");
  response.json({ success: true, data: result });
});
