import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { asyncHandler } from "../../common/async-handler.js";
import { HttpError } from "../../common/http-error.js";
import { Project } from "../projects/project.model.js";
import { ProjectMembership } from "../projects/project-membership.model.js";
import { DocumentAsset } from "./document-asset.model.js";
import { DocumentLegalHold } from "./document-legal-hold.model.js";
import { DocumentPurgeRequest } from "./document-purge-request.model.js";
import { DocumentGovernanceEvent } from "./document-governance-event.model.js";
import { evaluateProjectDocumentRetention } from "./document-retention.service.js";
import { runProjectMutationWithEvent } from "../collaboration/collaboration.service.js";

const createSchema = z.object({
  reference: z.string().trim().min(2).max(100),
  reason: z.string().trim().min(10).max(2000),
  assetIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(100),
});
const approvalSchema = z.object({ comment: z.string().trim().min(10).max(1000) });

const context = async (request: Request) => {
  if (!request.auth) throw new HttpError(401, "Authentication required");
  const auth = request.auth;
  const projectId = String(request.params.projectId);
  if (!mongoose.isValidObjectId(projectId)) throw new HttpError(404, "Project not found");
  const scope = { organizationId: auth.organizationId, projectId };
  const project = await Project.findOne({ _id: projectId, organizationId: auth.organizationId }).select("_id").lean();
  if (!project) throw new HttpError(404, "Project not found");
  const member = await ProjectMembership.findOne({ ...scope, userId: auth.userId, status: "active" }).select("role").lean();
  if (!member) throw new HttpError(403, "Active project membership is required");
  if (member.role !== "project_manager" && !["owner", "admin"].includes(auth.role)) throw new HttpError(403, "Project manager access is required for document purge governance");
  return { auth, scope };
};

export const createDocumentPurgeRequest = asyncHandler(async (request: Request, response: Response) => {
  const { auth, scope } = await context(request);
  const input = createSchema.parse(request.body);
  const assetIds = [...new Set(input.assetIds)];
  if (assetIds.length !== input.assetIds.length) throw new HttpError(400, "Duplicate asset IDs are not allowed");
  const evaluation = await evaluateProjectDocumentRetention(scope);
  if (!evaluation.enabled) throw new HttpError(409, "Document retention must be enabled before requesting a purge");
  const eligible = new Map(evaluation.eligibleForReview.map((candidate) => [candidate.assetId, candidate]));
  if (assetIds.some((id) => !eligible.has(id))) throw new HttpError(409, "Every requested asset must be an eligible retention review candidate with no active legal hold");
  const assets = await DocumentAsset.find({ ...scope, _id: { $in: assetIds } }).lean();
  if (assets.length !== assetIds.length) throw new HttpError(409, "One or more requested assets are no longer available");
  const candidates = assets.map((asset) => {
    const candidate = eligible.get(String(asset._id))!;
    return { assetId: asset._id, documentId: asset.documentId, documentNo: candidate.documentNo, version: asset.version, fileName: asset.fileName, storageKey: asset.storageKey, sha256: asset.sha256, byteSize: asset.byteSize };
  });
  const created = await runProjectMutationWithEvent({
    organizationId: auth.organizationId, projectId: scope.projectId, actorId: auth.userId,
    eventType: "documents.purge_request_created", targetType: "project", targetId: scope.projectId,
    summary: "A controlled document purge request was submitted for dual approval",
  }, async (session) => {
    const [item] = await DocumentPurgeRequest.create([{
      ...scope, ...input, requestedBy: auth.userId, requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: "awaiting_approval", candidates,
    }], session ? { session } : {});
    await DocumentGovernanceEvent.create([{
      ...scope, actorId: auth.userId, action: "purge_request_created",
      reference: input.reference, details: { purgeRequestId: String(item._id), assetCount: candidates.length, reason: input.reason },
    }], session ? { session } : {});
    return item;
  });
  response.status(201).json({ success: true, data: created, note: "No metadata or storage objects are deleted when a purge request is created." });
});

export const listDocumentPurgeRequests = asyncHandler(async (request: Request, response: Response) => {
  const { scope } = await context(request);
  const items = await DocumentPurgeRequest.find(scope).sort({ requestedAt: -1 }).limit(100).lean();
  response.json({ success: true, data: items });
});

export const approveDocumentPurgeRequest = asyncHandler(async (request: Request, response: Response) => {
  const { auth, scope } = await context(request);
  const requestId = String(request.params.purgeRequestId);
  if (!mongoose.isValidObjectId(requestId)) throw new HttpError(404, "Purge request not found");
  const input = approvalSchema.parse(request.body);
  const current = await DocumentPurgeRequest.findOne({ _id: requestId, ...scope }).lean();
  if (!current) throw new HttpError(404, "Purge request not found");
  if (String(current.requestedBy) === String(auth.userId)) throw new HttpError(403, "The requester cannot approve their own purge request");
  if (current.expiresAt <= new Date()) throw new HttpError(409, "Purge request has expired");
  if (current.status !== "awaiting_approval") throw new HttpError(409, "Purge request is not awaiting approval");
  const approval = { actorId: auth.userId, comment: input.comment, approvedAt: new Date() };
  const firstApproval = await DocumentPurgeRequest.findOneAndUpdate(
    { _id: requestId, ...scope, status: "awaiting_approval", expiresAt: { $gt: new Date() }, "approvals.0": { $exists: false }, approvals: { $not: { $elemMatch: { actorId: auth.userId } } } },
    { $push: { approvals: approval } }, { new: true },
  );
  const updated = firstApproval ?? await DocumentPurgeRequest.findOneAndUpdate(
    { _id: requestId, ...scope, status: "awaiting_approval", expiresAt: { $gt: new Date() }, "approvals.0": { $exists: true }, "approvals.1": { $exists: false }, approvals: { $not: { $elemMatch: { actorId: auth.userId } } } },
    { $push: { approvals: approval }, $set: { status: "approved" } }, { new: true },
  );
  if (!updated) throw new HttpError(409, "Approval was not recorded; two distinct non-requester approvers are required");
  await runProjectMutationWithEvent({
    organizationId: auth.organizationId, projectId: scope.projectId, actorId: auth.userId,
    eventType: "documents.purge_request_approved", targetType: "project", targetId: scope.projectId,
    summary: updated.status === "approved" ? "A document purge request received its second approval" : "A document purge request received its first approval",
  }, async (session) => {
    await DocumentGovernanceEvent.create([{
      ...scope, actorId: auth.userId, action: "purge_request_approved",
      reference: current.reference, details: { purgeRequestId: requestId, approvalCount: updated.approvals.length, status: updated.status },
    }], session ? { session } : {});
  });
  response.json({ success: true, data: updated, note: "Two distinct approvers, neither of whom is the requester, are required. Approval does not delete files." });
});

export const prepareDocumentPurgeManifest = asyncHandler(async (request: Request, response: Response) => {
  const { auth, scope } = await context(request);
  const requestId = String(request.params.purgeRequestId);
  if (!mongoose.isValidObjectId(requestId)) throw new HttpError(404, "Purge request not found");
  const purge = await DocumentPurgeRequest.findOne({ _id: requestId, ...scope }).lean();
  if (!purge) throw new HttpError(404, "Purge request not found");
  if (purge.status !== "approved" || purge.approvals.length !== 2) throw new HttpError(409, "Exactly two approvals are required before manifest preparation");
  if (purge.expiresAt <= new Date()) throw new HttpError(409, "Purge request has expired");

  // Last-moment safety gate: re-evaluate retention and legal holds immediately before manifest creation.
  const evaluation = await evaluateProjectDocumentRetention(scope);
  const eligible = new Map(evaluation.eligibleForReview.map((candidate) => [candidate.assetId, candidate]));
  const heldDocuments = await DocumentLegalHold.find({ ...scope, status: "active", documentId: { $in: purge.candidates.map((item) => item.documentId) } }).select("documentId").lean();
  if (heldDocuments.length) throw new HttpError(409, "Manifest blocked: one or more documents now have an active legal hold");
  if (purge.candidates.some((item) => !eligible.has(String(item.assetId)))) throw new HttpError(409, "Manifest blocked: one or more assets are no longer retention-eligible");
  const liveAssets = await DocumentAsset.find({ ...scope, _id: { $in: purge.candidates.map((item) => item.assetId) } }).lean();
  if (liveAssets.length !== purge.candidates.length) throw new HttpError(409, "Manifest blocked: an asset is missing");
  const liveById = new Map(liveAssets.map((asset) => [String(asset._id), asset]));
  for (const candidate of purge.candidates) {
    const live = liveById.get(String(candidate.assetId));
    if (!live || live.storageKey !== candidate.storageKey || live.sha256 !== candidate.sha256 || live.byteSize !== candidate.byteSize) {
      throw new HttpError(409, "Manifest blocked: an asset changed after the request was submitted");
    }
  }
  const entries = purge.candidates.map((item) => ({
    assetId: item.assetId, documentId: item.documentId, documentNo: item.documentNo,
    version: item.version, fileName: item.fileName, storageKey: item.storageKey,
    sha256: item.sha256, byteSize: item.byteSize,
  }));
  const manifestSha256 = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  const preparedAt = new Date();
  const updated = await runProjectMutationWithEvent({
    organizationId: auth.organizationId, projectId: scope.projectId, actorId: auth.userId,
    eventType: "documents.purge_manifest_prepared", targetType: "project", targetId: scope.projectId,
    summary: "A dual-approved document purge deletion manifest was prepared",
  }, async (session) => {
    const item = await DocumentPurgeRequest.findOneAndUpdate(
      { _id: requestId, ...scope, status: "approved", expiresAt: { $gt: preparedAt }, "approvals.1": { $exists: true }, "manifest.preparedAt": { $exists: false } },
      { $set: { status: "prepared", manifest: { preparedAt, preparedBy: auth.userId, entries, manifestSha256 } } },
      { new: true, ...(session ? { session } : {}) },
    );
    if (!item) throw new HttpError(409, "Purge request changed while the manifest was being prepared");
    await DocumentGovernanceEvent.create([{
      ...scope, actorId: auth.userId, action: "purge_manifest_prepared",
      reference: purge.reference, details: { purgeRequestId: requestId, manifestSha256, assetCount: entries.length },
    }], session ? { session } : {});
    return item;
  });
  response.json({
    success: true, data: updated,
    note: "Manifest prepared after a fresh legal-hold and retention check. This milestone deliberately does not delete metadata or storage objects; a separately reviewed quarantine/restore executor is required before irreversible purge can be enabled.",
  });
});
