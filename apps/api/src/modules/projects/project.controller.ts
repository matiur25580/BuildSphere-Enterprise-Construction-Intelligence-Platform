import type { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../../common/async-handler.js";
import { HttpError } from "../../common/http-error.js";
import { Project } from "./project.model.js";
import { WorkItem } from "./work-item.model.js";
import { ProjectMembership } from "./project-membership.model.js";
import { publishProjectEventSafely } from "../collaboration/collaboration.service.js";
import { createProjectSchema, updateProjectSchema, createWorkItemSchema, updateWorkItemSchema } from "./project.schemas.js";

const context = (request: Request) => {
  if (!request.auth) throw new HttpError(401, "Authentication required");
  return request.auth;
};


export const listProjects = asyncHandler(async (request: Request, response: Response) => {
  const auth = context(request);
  const projects = await Project.find({ organizationId: auth.organizationId }).sort({ updatedAt: -1 }).lean();
  const ids = projects.map((project) => project._id);
  const counts = await WorkItem.aggregate([
    { $match: { organizationId: new mongoose.Types.ObjectId(auth.organizationId), projectId: { $in: ids } } },
    { $group: { _id: "$projectId", total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } } } },
  ]);
  const countMap = new Map(counts.map((item) => [String(item._id), item]));
  response.json({ success: true, data: projects.map((project) => {
    const count = countMap.get(String(project._id));
    return { ...project, workItemCount: count?.total ?? 0, completedWorkItems: count?.completed ?? 0 };
  }) });
});

export const createProject = asyncHandler(async (request: Request, response: Response) => {
  const auth = context(request);
  const input = createProjectSchema.parse(request.body);
  const project = await Project.create({ ...input, organizationId: auth.organizationId, createdBy: auth.userId });
  await ProjectMembership.create({ organizationId: auth.organizationId, projectId: project._id, userId: auth.userId, role: "project_manager", status: "active", addedBy: auth.userId });
  response.status(201).json({ success: true, data: project });
});

export const getProject = asyncHandler(async (request: Request, response: Response) => {
  const auth = context(request);
  const project = await Project.findOne({ _id: request.params.projectId, organizationId: auth.organizationId });
  if (!project) throw new HttpError(404, "Project not found");
  const workItems = await WorkItem.find({ projectId: project._id, organizationId: auth.organizationId }).sort({ startDate: 1, code: 1 }).lean();
  response.json({ success: true, data: { project, workItems } });
});

export const updateProject = asyncHandler(async (request: Request, response: Response) => {
  const auth = context(request);
  const input = updateProjectSchema.parse(request.body);
  const existing = await Project.findOne({ _id: request.params.projectId, organizationId: auth.organizationId });
  if (!existing) throw new HttpError(404, "Project not found");
  const nextStart = input.startDate ?? existing.startDate;
  const nextEnd = input.targetEndDate ?? existing.targetEndDate;
  if (nextEnd < nextStart) throw new HttpError(400, "Target end date must be on or after the start date");
  Object.assign(existing, input);
  await existing.save();
  response.json({ success: true, data: existing });
});

export const listWorkItems = asyncHandler(async (request: Request, response: Response) => {
  const auth = context(request);
  const project = await Project.exists({ _id: request.params.projectId, organizationId: auth.organizationId });
  if (!project) throw new HttpError(404, "Project not found");
  const workItems = await WorkItem.find({ projectId: request.params.projectId, organizationId: auth.organizationId })
    .sort({ startDate: 1, code: 1 }).lean();
  response.json({ success: true, data: workItems });
});

export const createWorkItem = asyncHandler(async (request: Request, response: Response) => {
  const auth = context(request);
  const projectId = request.params.projectId;
  const project = await Project.findOne({ _id: projectId, organizationId: auth.organizationId });
  if (!project) throw new HttpError(404, "Project not found");
  const input = createWorkItemSchema.parse(request.body);
  if (input.startDate < project.startDate || input.endDate > project.targetEndDate) {
    throw new HttpError(400, "Work item dates must fall within the project date range");
  }
  if (input.parentId) {
    const parent = await WorkItem.exists({ _id: input.parentId, projectId, organizationId: auth.organizationId, type: "summary" });
    if (!parent) throw new HttpError(400, "Parent must be a summary item in this project");
  }
  if (input.predecessorIds.length) {
    const valid = await WorkItem.countDocuments({ _id: { $in: input.predecessorIds }, projectId, organizationId: auth.organizationId });
    if (valid !== new Set(input.predecessorIds).size) throw new HttpError(400, "Every predecessor must belong to this project");
  }
  if (input.assignedUserId) {
    const assignee = await ProjectMembership.exists({ organizationId: auth.organizationId, projectId, userId: input.assignedUserId, status: "active" });
    if (!assignee) throw new HttpError(400, "Assignee must be an active member of this project");
  }
  const item = await WorkItem.create({
    ...input, parentId: input.parentId || null, organizationId: auth.organizationId, projectId,
  });
  if (input.assignedUserId) await publishProjectEventSafely({ organizationId: auth.organizationId, projectId: String(projectId), actorId: auth.userId, eventType: "tasks.assigned", targetType: "work_item", targetId: String(item._id), summary: `Work item assigned: ${item.title}`, recipientIds: [input.assignedUserId] });
  response.status(201).json({ success: true, data: item });
});

export const updateWorkItem = asyncHandler(async (request: Request, response: Response) => {
  const auth = context(request);
  const input = updateWorkItemSchema.parse(request.body);
  const existing = await WorkItem.findOne({
    _id: request.params.itemId, projectId: request.params.projectId, organizationId: auth.organizationId,
  });
  if (!existing) throw new HttpError(404, "Work item not found");
  const nextStart = input.startDate ?? existing.startDate;
  const nextEnd = input.endDate ?? existing.endDate;
  if (nextEnd < nextStart) throw new HttpError(400, "End date must be on or after the start date");
  if (input.assignedUserId) {
    const assignee = await ProjectMembership.exists({ organizationId: auth.organizationId, projectId: request.params.projectId, userId: input.assignedUserId, status: "active" });
    if (!assignee) throw new HttpError(400, "Assignee must be an active member of this project");
  }
  if (input.predecessorIds) {
    if (input.predecessorIds.some((id) => id === String(existing._id))) throw new HttpError(400, "An item cannot depend on itself");
    const valid = await WorkItem.countDocuments({ _id: { $in: input.predecessorIds }, projectId: request.params.projectId, organizationId: auth.organizationId });
    if (valid !== new Set(input.predecessorIds).size) throw new HttpError(400, "Every predecessor must belong to this project");
  }
  const previousAssignee = existing.assignedUserId ? String(existing.assignedUserId) : null;
  Object.assign(existing, input);
  if (input.status === "completed" && input.progress === undefined) existing.progress = 100;
  await existing.save();
  const nextAssignee = existing.assignedUserId ? String(existing.assignedUserId) : null;
  if (nextAssignee && nextAssignee !== previousAssignee) await publishProjectEventSafely({ organizationId: auth.organizationId, projectId: String(request.params.projectId), actorId: auth.userId, eventType: "tasks.assigned", targetType: "work_item", targetId: String(existing._id), summary: `Work item assigned: ${existing.title}`, recipientIds: [nextAssignee] });
  response.json({ success: true, data: existing });
});
