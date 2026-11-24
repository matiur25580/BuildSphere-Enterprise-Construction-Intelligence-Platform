import type { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../../common/async-handler.js";
import { HttpError } from "../../common/http-error.js";
import { Project } from "../projects/project.model.js";
import { ProjectMembership } from "../projects/project-membership.model.js";
import { ProjectDocument } from "../delivery/project-document.model.js";
import { DocumentAsset } from "../delivery/document-asset.model.js";
import { BimModel } from "./bim-model.model.js";
import { BimIssue } from "./bim-issue.model.js";
import { registerBimModelSchema, createBimIssueSchema, updateBimIssueSchema } from "./bim.schemas.js";
import { runProjectMutationWithEvent } from "../collaboration/collaboration.service.js";

// Establish authenticated organization and active project membership before BIM operations proceed.
const context = async (request: Request) => {
  if (!request.auth) throw new HttpError(401, "Authentication required");
  const projectId = String(request.params.projectId);
  if (!mongoose.isValidObjectId(projectId)) throw new HttpError(404, "Project not found");
  const scope = { organizationId: request.auth.organizationId, projectId };
  const project = await Project.findOne({ _id: projectId, organizationId: request.auth.organizationId }).select("_id");
  if (!project) throw new HttpError(404, "Project not found");
  const member = await ProjectMembership.findOne({ ...scope, userId: request.auth.userId, status: "active" }).select("role").lean();
  if (!member && !["owner", "admin"].includes(request.auth.role)) {
    throw new HttpError(403, "Active project membership is required");
  }
  return { auth: request.auth, scope, projectId, member: member ?? { role: "project_manager" as const } };
};
const requireManager = (authRole: string, projectRole: string) => {
  if (projectRole !== "project_manager" && !["owner", "admin"].includes(authRole)) throw new HttpError(403, "Project manager access is required");
};

export const listBimModels = asyncHandler(async (request: Request, response: Response) => {
  const { scope } = await context(request);
  const models = await BimModel.find(scope).sort({ discipline: 1, updatedAt: -1 }).limit(200).populate("documentId", "documentNo title category currentVersion approvalStatus").lean();
  response.json({ success: true, data: models });
});

export const registerBimModel = asyncHandler(async (request: Request, response: Response) => {
  const { auth, scope, projectId, member } = await context(request);
  requireManager(auth.role, member.role);
  const input = registerBimModelSchema.parse(request.body);
  const document = await ProjectDocument.findOne({ _id: input.documentId, ...scope }).lean();
  if (!document) throw new HttpError(404, "Controlled document not found");
  if (document.currentVersion < 1) throw new HttpError(409, "Upload an IFC file version to the controlled document before registering it as a BIM model");
  const currentVersion = document.versions.find((version) => version.version === document.currentVersion);
  if (!currentVersion?.fileAssetId) throw new HttpError(409, "BIM registration requires a privately stored IFC file, not an external URL reference");
  const asset = await DocumentAsset.findOne({ _id: currentVersion.fileAssetId, documentId: document._id, ...scope, scanStatus: "clean", contentType: "application/ifc" }).lean();
  if (!asset) throw new HttpError(415, "The current controlled document version must be a malware-scanned IFC file");
  const item = new BimModel({
    ...scope, documentId: document._id, assetId: asset._id, modelName: input.modelName,
    discipline: input.discipline, revision: input.revision, ifcSchema: input.ifcSchema,
    modelVersion: currentVersion.version, checksum: asset.sha256, description: input.description,
    registeredBy: auth.userId,
  });
  await runProjectMutationWithEvent({
    organizationId: auth.organizationId, projectId, actorId: auth.userId,
    eventType: "bim.model_registered", targetType: "bim_model", targetId: String(item._id),
    summary: `BIM model registered: ${input.modelName} (v${currentVersion.version})`,
  }, (session) => item.save(session ? { session } : {}));
  response.status(201).json({ success: true, data: item });
});

export const listBimIssues = asyncHandler(async (request: Request, response: Response) => {
  const { scope } = await context(request);
  const filter: Record<string, unknown> = { ...scope };
  if (typeof request.query.status === "string") filter.status = request.query.status;
  if (typeof request.query.modelId === "string" && mongoose.isValidObjectId(request.query.modelId)) filter.modelId = request.query.modelId;
  if (typeof request.query.priority === "string") filter.priority = request.query.priority;
  const issues = await BimIssue.find(filter).sort({ priority: -1, dueDate: 1, updatedAt: -1 }).limit(300).populate("assignedToUserId", "name email").populate("modelId", "modelName discipline revision modelVersion").lean();
  response.json({ success: true, data: issues });
});

export const createBimIssue = asyncHandler(async (request: Request, response: Response) => {
  const { auth, scope, projectId, member } = await context(request);
  requireManager(auth.role, member.role);
  const input = createBimIssueSchema.parse(request.body);
  const model = await BimModel.findOne({ _id: input.modelId, ...scope }).lean();
  if (!model) throw new HttpError(404, "BIM model not found");
  if (input.assignedToUserId) {
    const assignee = await ProjectMembership.exists({ ...scope, userId: input.assignedToUserId, status: "active" });
    if (!assignee) throw new HttpError(422, "Assignee must be an active member of this project");
  }
  const item = new BimIssue({
    ...scope, ...input, modelId: model._id, modelVersion: model.modelVersion,
    assignedToUserId: input.assignedToUserId ?? null, dueDate: input.dueDate ?? null,
    createdBy: auth.userId, history: [{ status: "open", comment: "Issue created", actorId: auth.userId }],
  });
  await runProjectMutationWithEvent({
    organizationId: auth.organizationId, projectId, actorId: auth.userId,
    eventType: "bim.issue_created", targetType: "bim_issue", targetId: String(item._id),
    summary: `BIM issue created: ${input.reference} · ${input.title}`,
  }, (session) => item.save(session ? { session } : {}));
  response.status(201).json({ success: true, data: item });
});

export const updateBimIssue = asyncHandler(async (request: Request, response: Response) => {
  const { auth, scope, projectId, member } = await context(request);
  requireManager(auth.role, member.role);
  const input = updateBimIssueSchema.parse(request.body);
  const item = await BimIssue.findOne({ _id: String(request.params.issueId), ...scope });
  if (!item) throw new HttpError(404, "BIM issue not found");
  const allowed: Record<string, string[]> = {
    open: ["in_progress"], in_progress: ["resolved"], resolved: ["closed", "reopened"],
    reopened: ["in_progress"], closed: ["reopened"],
  };
  if (!allowed[item.status]?.includes(input.status)) throw new HttpError(409, `Cannot move BIM issue from ${item.status} to ${input.status}`);
  item.status = input.status;
  item.history.push({ status: input.status, comment: input.comment, actorId: new mongoose.Types.ObjectId(auth.userId), actedAt: new Date() });
  await runProjectMutationWithEvent({
    organizationId: auth.organizationId, projectId, actorId: auth.userId,
    eventType: "bim.issue_status_changed", targetType: "bim_issue", targetId: String(item._id),
    summary: `BIM issue ${item.reference} moved to ${input.status}`,
  }, (session) => item.save(session ? { session } : {}));
  response.json({ success: true, data: item });
});
