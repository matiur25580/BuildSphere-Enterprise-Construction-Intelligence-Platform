import type { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../../common/async-handler.js";
import { HttpError } from "../../common/http-error.js";
import { Membership } from "../organizations/membership.model.js";
import { Project } from "./project.model.js";
import { ProjectMembership } from "./project-membership.model.js";
import { addProjectMemberSchema, updateProjectMemberSchema } from "./project-membership.schemas.js";

const context = (request: Request) => {
  if (!request.auth) throw new HttpError(401, "Authentication required");
  return request.auth;
};
const projectScope = async (request: Request, organizationId: string) => {
  const projectId = String(request.params.projectId);
  if (!mongoose.isValidObjectId(projectId) || !await Project.exists({ _id: projectId, organizationId })) throw new HttpError(404, "Project not found");
  return { organizationId, projectId };
};

export const listProjectMembers = asyncHandler(async (request: Request, response: Response) => {
  const auth = context(request);
  const scope = await projectScope(request, auth.organizationId);
  const members = await ProjectMembership.find(scope).populate("userId", "name email").sort({ role: 1, createdAt: 1 }).lean();
  response.json({ success: true, data: members });
});

export const addProjectMember = asyncHandler(async (request: Request, response: Response) => {
  const auth = context(request);
  const scope = await projectScope(request, auth.organizationId);
  const input = addProjectMemberSchema.parse(request.body);
  const activeMembership = await Membership.exists({ organizationId: auth.organizationId, userId: input.userId, status: "active" });
  if (!activeMembership) throw new HttpError(404, "Active organization member not found");
  const member = await ProjectMembership.findOneAndUpdate(
    { ...scope, userId: input.userId },
    { $set: { role: input.role, status: "active", addedBy: auth.userId }, $setOnInsert: scope },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  ).populate("userId", "name email");
  response.status(201).json({ success: true, data: member });
});

export const updateProjectMember = asyncHandler(async (request: Request, response: Response) => {
  const auth = context(request);
  const scope = await projectScope(request, auth.organizationId);
  const input = updateProjectMemberSchema.parse(request.body);
  if (!mongoose.isValidObjectId(String(request.params.memberId))) throw new HttpError(404, "Project member not found");
  const member = await ProjectMembership.findOneAndUpdate(
    { ...scope, _id: request.params.memberId },
    { $set: input },
    { new: true, runValidators: true },
  ).populate("userId", "name email");
  if (!member) throw new HttpError(404, "Project member not found");
  response.json({ success: true, data: member });
});
