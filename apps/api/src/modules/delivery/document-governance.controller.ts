import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { asyncHandler } from "../../common/async-handler.js";
import { HttpError } from "../../common/http-error.js";
import { Project } from "../projects/project.model.js";
import { ProjectMembership } from "../projects/project-membership.model.js";
import { ProjectDocument } from "./project-document.model.js";
import { DocumentRetentionPolicy } from "./document-retention-policy.model.js";
import { DocumentLegalHold } from "./document-legal-hold.model.js";
import { DocumentGovernanceEvent } from "./document-governance-event.model.js";
import { evaluateProjectDocumentRetention } from "./document-retention.service.js";
import { runProjectMutationWithEvent } from "../collaboration/collaboration.service.js";

const policySchema = z.object({ enabled: z.boolean(), retentionDays: z.number().int().min(365).max(36500), minimumVersions: z.number().int().min(1).max(100), reviewBeforePurgeDays: z.number().int().min(1).max(365) });
const holdSchema = z.object({ reference: z.string().trim().min(2).max(100), reason: z.string().trim().min(10).max(2000) });
const releaseSchema = z.object({ comment: z.string().trim().min(10).max(2000) });

const context = async (request: Request) => {
  if (!request.auth) throw new HttpError(401, "Authentication required");
  const auth = request.auth; const projectId = String(request.params.projectId);
  if (!mongoose.isValidObjectId(projectId)) throw new HttpError(404, "Project not found");
  const scope = { organizationId: auth.organizationId, projectId };
  const project = await Project.findOne({ _id: projectId, organizationId: auth.organizationId }).select("_id").lean();
  if (!project) throw new HttpError(404, "Project not found");
  const member = await ProjectMembership.findOne({ ...scope, userId: auth.userId, status: "active" }).select("role").lean();
  if (!member) throw new HttpError(403, "Active project membership is required");
  if (member.role !== "project_manager" && !["owner", "admin"].includes(auth.role)) throw new HttpError(403, "Project manager access is required for document governance");
  return { auth, scope };
};

export const getDocumentRetentionPolicy = asyncHandler(async (request: Request, response: Response) => {
  const { scope } = await context(request); const policy = await DocumentRetentionPolicy.findOne(scope).lean();
  response.json({ success: true, data: policy ?? { enabled: false, retentionDays: 2555, minimumVersions: 1, reviewBeforePurgeDays: 30 } });
});

export const updateDocumentRetentionPolicy = asyncHandler(async (request: Request, response: Response) => {
  const { auth, scope } = await context(request); const input = policySchema.parse(request.body);
  const policy = await runProjectMutationWithEvent({ organizationId: auth.organizationId, projectId: scope.projectId, actorId: auth.userId, eventType: "documents.retention_policy_updated", targetType: "project", targetId: scope.projectId, summary: "Project document retention policy updated" }, async (session) => {
    const item = await DocumentRetentionPolicy.findOneAndUpdate(scope, { $set: { ...input, updatedBy: auth.userId }, $setOnInsert: scope }, { new: true, upsert: true, runValidators: true, ...(session ? { session } : {}) });
    await DocumentGovernanceEvent.create([{ ...scope, actorId: auth.userId, action: "retention_policy_updated", details: input }], session ? { session } : {});
    return item;
  });
  response.json({ success: true, data: policy });
});

export const evaluateDocumentRetention = asyncHandler(async (request: Request, response: Response) => {
  const { scope } = await context(request); const evaluation = await evaluateProjectDocumentRetention(scope);
  response.json({ success: true, data: evaluation, note: "Eligible records are review candidates only. No document or storage object is deleted by this evaluation." });
});

export const listDocumentLegalHolds = asyncHandler(async (request: Request, response: Response) => {
  const { scope } = await context(request); const holds = await DocumentLegalHold.find(scope).sort({ createdAt: -1 }).limit(200).lean();
  response.json({ success: true, data: holds });
});

export const placeDocumentLegalHold = asyncHandler(async (request: Request, response: Response) => {
  const { auth, scope } = await context(request); const documentId = String(request.params.documentId);
  if (!mongoose.isValidObjectId(documentId)) throw new HttpError(404, "Document not found");
  const input = holdSchema.parse(request.body);
  const document = await ProjectDocument.findOne({ _id: documentId, ...scope }).select("_id").lean();
  if (!document) throw new HttpError(404, "Document not found");
  if (await DocumentLegalHold.exists({ ...scope, documentId, status: "active" })) throw new HttpError(409, "An active legal hold already exists for this document");
  const hold = await runProjectMutationWithEvent({ organizationId: auth.organizationId, projectId: scope.projectId, actorId: auth.userId, eventType: "documents.legal_hold_placed", targetType: "document", targetId: documentId, summary: "A legal hold was placed on a project document" }, async (session) => {
    const [created] = await DocumentLegalHold.create([{ ...scope, documentId, ...input, createdBy: auth.userId, status: "active" }], session ? { session } : {});
    await DocumentGovernanceEvent.create([{ ...scope, documentId, actorId: auth.userId, action: "legal_hold_placed", reference: input.reference, details: { reason: input.reason } }], session ? { session } : {});
    return created;
  });
  response.status(201).json({ success: true, data: hold });
});

export const releaseDocumentLegalHold = asyncHandler(async (request: Request, response: Response) => {
  const { auth, scope } = await context(request); const documentId = String(request.params.documentId); const holdId = String(request.params.holdId);
  if (!mongoose.isValidObjectId(documentId) || !mongoose.isValidObjectId(holdId)) throw new HttpError(404, "Legal hold not found");
  const input = releaseSchema.parse(request.body);
  const hold = await runProjectMutationWithEvent({ organizationId: auth.organizationId, projectId: scope.projectId, actorId: auth.userId, eventType: "documents.legal_hold_released", targetType: "document", targetId: documentId, summary: "A legal hold was released from a project document" }, async (session) => {
    const item = await DocumentLegalHold.findOneAndUpdate({ _id: holdId, ...scope, documentId, status: "active" }, { $set: { status: "released", releasedBy: auth.userId, releasedAt: new Date(), releaseComment: input.comment } }, { new: true, runValidators: true, ...(session ? { session } : {}) });
    if (!item) throw new HttpError(404, "Active legal hold not found");
    await DocumentGovernanceEvent.create([{ ...scope, documentId, actorId: auth.userId, action: "legal_hold_released", reference: item.reference, details: { comment: input.comment } }], session ? { session } : {});
    return item;
  });
  response.json({ success: true, data: hold });
});
