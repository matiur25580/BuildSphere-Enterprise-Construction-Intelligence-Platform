import type { Request, Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { asyncHandler } from "../../common/async-handler.js";
import { HttpError } from "../../common/http-error.js";
import { Project } from "../projects/project.model.js";
import { ProjectMembership } from "../projects/project-membership.model.js";
import { Inspection } from "./inspection.model.js";
import { Ncr, Capa } from "./ncr.model.js";
import { SafetyEvent } from "./safety-event.model.js";
import { Rfi } from "./rfi.model.js";
import { Submittal } from "./submittal.model.js";
import { ProjectDocument } from "./project-document.model.js";
import { DocumentAsset } from "./document-asset.model.js";
import { DocumentAuditEvent } from "./document-audit.model.js";
import { DocumentUploadSession } from "./document-upload-session.model.js";
import { deleteDocumentObject, normalizeDocumentFile, putDocumentObject, readDocumentObject, scanDocumentWithClamAv } from "./document-storage.js";
import { getCollaborationTransactionStatus } from "../collaboration/collaboration.service.js";
import { runProjectMutationWithEvent } from "../collaboration/collaboration.service.js";
import { createInspectionSchema, inspectionStatusSchema, createNcrSchema, ncrStatusSchema, createCapaSchema, capaStatusSchema, createSafetyEventSchema, safetyStatusSchema, createRfiSchema, respondRfiSchema, createSubmittalSchema, reviewSubmittalSchema, createDocumentSchema, addDocumentVersionSchema, documentApprovalSchema, createDocumentUploadSchema, documentUploadPartSchema } from "./delivery.schemas.js";

const authContext = (request: Request) => { if (!request.auth) throw new HttpError(401, "Authentication required"); return request.auth; };
const projectContext = async (request: Request) => {
  const auth = authContext(request); const projectId = String(request.params.projectId);
  if (!mongoose.isValidObjectId(projectId)) throw new HttpError(404, "Project not found");
  const project = await Project.findOne({ _id: projectId, organizationId: auth.organizationId }).select("_id startDate targetEndDate");
  if (!project) throw new HttpError(404, "Project not found");
  return { auth, projectId, scope: { organizationId: auth.organizationId, projectId } };
};
const transition = (current: string, next: string, allowed: Record<string, string[]>, label: string) => { if (!allowed[current]?.includes(next)) throw new HttpError(409, `Cannot move ${label} from ${current} to ${next}`); };
const DOCUMENT_UPLOAD_PART_BYTES = 5 * 1024 * 1024;
const requireDocumentUploadManager = async (scope: { organizationId: string; projectId: string }, userId: string, role: string) => {
  const member = await ProjectMembership.findOne({ ...scope, userId, status: "active" }).select("role").lean();
  if (!member || (member.role !== "project_manager" && !["owner", "admin"].includes(role))) throw new HttpError(403, "Project manager access is required to upload documents");
};

export const getDeliverySummary = asyncHandler(async (request: Request, response: Response) => {
  const { scope } = await projectContext(request);
  const [inspections, openNcrs, openCapas, safetyEvents, openRfis, openSubmittals, documents, pendingApprovals] = await Promise.all([
    Inspection.countDocuments(scope), Ncr.countDocuments({ ...scope, status: { $ne: "closed" } }), Capa.countDocuments({ ...scope, status: { $ne: "verified" } }), SafetyEvent.countDocuments({ ...scope, status: { $ne: "closed" } }), Rfi.countDocuments({ ...scope, status: { $nin: ["responded", "closed"] } }), Submittal.countDocuments({ ...scope, status: { $nin: ["approved", "approved_as_noted"] } }), ProjectDocument.countDocuments(scope), ProjectDocument.countDocuments({ ...scope, approvalStatus: "submitted" }),
  ]);
  response.json({ success: true, data: { inspections, openNcrs, openCapas, openSafetyEvents: safetyEvents, openRfis, pendingSubmittals: openSubmittals, documents, pendingDocumentApprovals: pendingApprovals } });
});

export const listInspections = asyncHandler(async (request: Request, response: Response) => { const { scope } = await projectContext(request); response.json({ success: true, data: await Inspection.find(scope).sort({ inspectionDate: -1 }).limit(100).lean() }); });
export const createInspection = asyncHandler(async (request: Request, response: Response) => { const { auth, scope } = await projectContext(request); const input = createInspectionSchema.parse(request.body); const item = new Inspection({ ...input, ...scope, createdBy: auth.userId }); await runProjectMutationWithEvent({ organizationId: auth.organizationId, projectId: String(request.params.projectId), actorId: auth.userId, eventType: "quality.inspection_created", targetType: "inspection", targetId: String(item._id), summary: "Quality inspection created" }, (session) => item.save(session ? { session } : {})); response.status(201).json({ success: true, data: item }); });
export const updateInspectionStatus = asyncHandler(async (request: Request, response: Response) => { const { auth, scope } = await projectContext(request); const input = inspectionStatusSchema.parse(request.body); const item = await Inspection.findOne({ _id: String(request.params.inspectionId), ...scope }); if (!item) throw new HttpError(404, "Inspection not found"); transition(item.status, input.status, { draft: ["submitted"], submitted: ["accepted", "rejected"], rejected: ["submitted"] }, "inspection"); item.status = input.status; if (input.notes) item.notes = input.notes; await runProjectMutationWithEvent({ organizationId: auth.organizationId, projectId: String(request.params.projectId), actorId: auth.userId, eventType: "quality.inspection_status_changed", targetType: "inspection", targetId: String(item._id), summary: `Inspection status changed to ${item.status}` }, (session) => item.save(session ? { session } : {})); response.json({ success: true, data: item }); });

export const listNcrs = asyncHandler(async (request: Request, response: Response) => { const { scope } = await projectContext(request); const items = await Ncr.find(scope).sort({ createdAt: -1 }).limit(100).lean(); response.json({ success: true, data: items }); });
export const createNcr = asyncHandler(async (request: Request, response: Response) => { const { auth, scope } = await projectContext(request); const input = createNcrSchema.parse(request.body); const item = new Ncr({ ...input, ...scope, raisedBy: auth.userId }); await runProjectMutationWithEvent({ organizationId: auth.organizationId, projectId: String(request.params.projectId), actorId: auth.userId, eventType: "quality.ncr_created", targetType: "ncr", targetId: String(item._id), summary: "Non-conformance report created" }, (session) => item.save(session ? { session } : {})); response.status(201).json({ success: true, data: item }); });
export const updateNcrStatus = asyncHandler(async (request: Request, response: Response) => { const { auth, scope } = await projectContext(request); const input = ncrStatusSchema.parse(request.body); const item = await Ncr.findOne({ _id: String(request.params.ncrId), ...scope }); if (!item) throw new HttpError(404, "NCR not found"); transition(item.status, input.status, { open: ["under_review"], under_review: ["corrective_action"], corrective_action: ["verification"], verification: ["corrective_action", "closed"] }, "NCR"); if (input.status === "closed") { const outstanding = await Capa.countDocuments({ ...scope, ncrId: item._id, status: { $ne: "verified" } }); if (outstanding > 0) throw new HttpError(409, "All linked CAPA actions must be verified before closing this NCR"); item.closedAt = new Date(); item.closureNotes = input.closureNotes ?? ""; } item.status = input.status; await runProjectMutationWithEvent({ organizationId: auth.organizationId, projectId: String(request.params.projectId), actorId: auth.userId, eventType: "quality.ncr_status_changed", targetType: "ncr", targetId: String(item._id), summary: "Non-conformance report status changed" }, (session) => item.save(session ? { session } : {})); response.json({ success: true, data: item }); });
export const listCapas = asyncHandler(async (request: Request, response: Response) => { const { scope } = await projectContext(request); const items = await Capa.find({ ...scope, ncrId: String(request.params.ncrId) }).sort({ dueDate: 1 }).limit(100).lean(); response.json({ success: true, data: items }); });
export const createCapa = asyncHandler(async (request: Request, response: Response) => { const { auth, scope } = await projectContext(request); const ncr = await Ncr.findOne({ _id: String(request.params.ncrId), ...scope }); if (!ncr) throw new HttpError(404, "NCR not found"); if (["verification", "closed"].includes(ncr.status)) throw new HttpError(409, "CAPA actions cannot be added during verification or after closure"); const input = createCapaSchema.parse(request.body); const item = new Capa({ ...input, ...scope, ncrId: ncr._id, createdBy: auth.userId }); if (ncr.status === "open" || ncr.status === "under_review") ncr.status = "corrective_action"; await runProjectMutationWithEvent({ organizationId: auth.organizationId, projectId: String(request.params.projectId), actorId: auth.userId, eventType: "quality.capa_created", targetType: "capa", targetId: String(item._id), summary: "Corrective action created" }, async (session) => { await item.save(session ? { session } : {}); await ncr.save(session ? { session } : {}); return item; }); response.status(201).json({ success: true, data: item }); });
export const updateCapaStatus = asyncHandler(async (request: Request, response: Response) => { const { auth, scope } = await projectContext(request); const input = capaStatusSchema.parse(request.body); const item = await Capa.findOne({ _id: String(request.params.capaId), ...scope }); if (!item) throw new HttpError(404, "CAPA action not found"); transition(item.status, input.status, { open: ["in_progress"], in_progress: ["completed"], completed: ["verified"] }, "CAPA action"); if (input.status === "completed" && !input.completionNotes?.trim()) throw new HttpError(400, "Completion notes are required"); item.status = input.status; if (input.completionNotes) item.completionNotes = input.completionNotes; if (input.status === "verified") item.verifiedAt = new Date(); await runProjectMutationWithEvent({ organizationId: auth.organizationId, projectId: String(request.params.projectId), actorId: auth.userId, eventType: "quality.capa_status_changed", targetType: "capa", targetId: String(item._id), summary: "Corrective action status changed" }, (session) => item.save(session ? { session } : {})); response.json({ success: true, data: item }); });

export const listSafetyEvents = asyncHandler(async (request: Request, response: Response) => { const { scope } = await projectContext(request); response.json({ success: true, data: await SafetyEvent.find(scope).sort({ occurredAt: -1 }).limit(100).lean() }); });
export const createSafetyEvent = asyncHandler(async (request: Request, response: Response) => { const { auth, scope } = await projectContext(request); const input = createSafetyEventSchema.parse(request.body); const item = new SafetyEvent({ ...input, ...scope, reportedBy: auth.userId }); await runProjectMutationWithEvent({ organizationId: auth.organizationId, projectId: String(request.params.projectId), actorId: auth.userId, eventType: "safety.event_created", targetType: "safety_event", targetId: String(item._id), summary: "Safety event reported" }, (session) => item.save(session ? { session } : {})); response.status(201).json({ success: true, data: item }); });
export const updateSafetyStatus = asyncHandler(async (request: Request, response: Response) => { const { auth, scope } = await projectContext(request); const input = safetyStatusSchema.parse(request.body); const item = await SafetyEvent.findOne({ _id: String(request.params.eventId), ...scope }); if (!item) throw new HttpError(404, "Safety event not found"); transition(item.status, input.status, { reported: ["under_review"], under_review: ["controls_assigned"], controls_assigned: ["closed"] }, "safety event"); if (input.status === "closed") item.closedAt = new Date(); item.status = input.status; if (input.closureNotes) item.immediateAction = [item.immediateAction, input.closureNotes].filter(Boolean).join("\nClosure: "); await runProjectMutationWithEvent({ organizationId: auth.organizationId, projectId: String(request.params.projectId), actorId: auth.userId, eventType: "safety.event_status_changed", targetType: "safety_event", targetId: String(item._id), summary: `Safety event status changed to ${item.status}` }, (session) => item.save(session ? { session } : {})); response.json({ success: true, data: item }); });

export const listRfis = asyncHandler(async (request: Request, response: Response) => { const { scope } = await projectContext(request); response.json({ success: true, data: await Rfi.find(scope).sort({ createdAt: -1 }).limit(100).lean() }); });
export const createRfi = asyncHandler(async (request: Request, response: Response) => { const { auth, scope } = await projectContext(request); const input = createRfiSchema.parse(request.body); const item = new Rfi({ ...input, ...scope, createdBy: auth.userId }); await runProjectMutationWithEvent({ organizationId: auth.organizationId, projectId: String(request.params.projectId), actorId: auth.userId, eventType: "coordination.rfi_created", targetType: "rfi", targetId: String(item._id), summary: "RFI created" }, (session) => item.save(session ? { session } : {})); response.status(201).json({ success: true, data: item }); });
export const submitRfi = asyncHandler(async (request: Request, response: Response) => { const { auth, scope } = await projectContext(request); const item = await Rfi.findOne({ _id: String(request.params.rfiId), ...scope }); if (!item) throw new HttpError(404, "RFI not found"); transition(item.status, "submitted", { draft: ["submitted"] }, "RFI"); item.status = "submitted"; await runProjectMutationWithEvent({ organizationId: auth.organizationId, projectId: String(request.params.projectId), actorId: auth.userId, eventType: "coordination.rfi_submitted", targetType: "rfi", targetId: String(item._id), summary: "RFI submitted" }, (session) => item.save(session ? { session } : {})); response.json({ success: true, data: item }); });
export const respondRfi = asyncHandler(async (request: Request, response: Response) => { const { auth, scope } = await projectContext(request); const input = respondRfiSchema.parse(request.body); const item = await Rfi.findOne({ _id: String(request.params.rfiId), ...scope }); if (!item) throw new HttpError(404, "RFI not found"); transition(item.status, input.status, { submitted: ["responded"], responded: ["closed"] }, "RFI"); if (input.status === "responded") { item.response = input.response; item.respondedBy = new mongoose.Types.ObjectId(auth.userId); item.respondedAt = new Date(); } item.status = input.status; await runProjectMutationWithEvent({ organizationId: auth.organizationId, projectId: String(request.params.projectId), actorId: auth.userId, eventType: "coordination.rfi_responded", targetType: "rfi", targetId: String(item._id), summary: "RFI response recorded" }, (session) => item.save(session ? { session } : {})); response.json({ success: true, data: item }); });

export const listSubmittals = asyncHandler(async (request: Request, response: Response) => { const { scope } = await projectContext(request); response.json({ success: true, data: await Submittal.find(scope).sort({ createdAt: -1 }).limit(100).lean() }); });
export const createSubmittal = asyncHandler(async (request: Request, response: Response) => { const { auth, scope } = await projectContext(request); const input = createSubmittalSchema.parse(request.body); const item = new Submittal({ ...input, ...scope, createdBy: auth.userId }); await runProjectMutationWithEvent({ organizationId: auth.organizationId, projectId: String(request.params.projectId), actorId: auth.userId, eventType: "coordination.submittal_created", targetType: "submittal", targetId: String(item._id), summary: "Submittal created" }, (session) => item.save(session ? { session } : {})); response.status(201).json({ success: true, data: item }); });
export const submitSubmittal = asyncHandler(async (request: Request, response: Response) => { const { auth, scope } = await projectContext(request); const item = await Submittal.findOne({ _id: String(request.params.submittalId), ...scope }); if (!item) throw new HttpError(404, "Submittal not found"); transition(item.status, "submitted", { draft: ["submitted"], resubmit: ["submitted"], rejected: ["submitted"] }, "submittal"); item.status = "submitted"; await runProjectMutationWithEvent({ organizationId: auth.organizationId, projectId: String(request.params.projectId), actorId: auth.userId, eventType: "coordination.submittal_submitted", targetType: "submittal", targetId: String(item._id), summary: "Submittal submitted" }, (session) => item.save(session ? { session } : {})); response.json({ success: true, data: item }); });
export const reviewSubmittal = asyncHandler(async (request: Request, response: Response) => { const { auth, scope } = await projectContext(request); const input = reviewSubmittalSchema.parse(request.body); const item = await Submittal.findOne({ _id: String(request.params.submittalId), ...scope }); if (!item) throw new HttpError(404, "Submittal not found"); transition(item.status, input.status, { submitted: ["under_review", "approved", "approved_as_noted", "rejected", "resubmit"], under_review: ["approved", "approved_as_noted", "rejected", "resubmit"] }, "submittal"); item.status = input.status; item.reviewerResponse = input.reviewerResponse ?? ""; item.reviewedBy = new mongoose.Types.ObjectId(auth.userId); item.reviewedAt = new Date(); await runProjectMutationWithEvent({ organizationId: auth.organizationId, projectId: String(request.params.projectId), actorId: auth.userId, eventType: "coordination.submittal_reviewed", targetType: "submittal", targetId: String(item._id), summary: "Submittal review completed" }, (session) => item.save(session ? { session } : {})); response.json({ success: true, data: item }); });

export const listDocuments = asyncHandler(async (request: Request, response: Response) => { const { scope } = await projectContext(request); response.json({ success: true, data: await ProjectDocument.find(scope).sort({ documentNo: 1 }).limit(100).lean() }); });
export const createDocument = asyncHandler(async (request: Request, response: Response) => { const { auth, scope } = await projectContext(request); const input = createDocumentSchema.parse(request.body); const { fileUrl, fileName, checksum, notes, ...metadata } = input; const versions = fileUrl && fileName ? [{ version: 1, fileUrl, fileName, checksum, notes, uploadedBy: auth.userId }] : []; const item = new ProjectDocument({ ...metadata, ...scope, createdBy: auth.userId, currentVersion: versions.length, versions }); await runProjectMutationWithEvent({ organizationId: auth.organizationId, projectId: String(request.params.projectId), actorId: auth.userId, eventType: "documents.created", targetType: "document", targetId: String(item._id), summary: "Project document registered" }, (session) => item.save(session ? { session } : {})); response.status(201).json({ success: true, data: item }); });
export const addDocumentVersion = asyncHandler(async (request: Request, response: Response) => { const { auth, scope } = await projectContext(request); const input = addDocumentVersionSchema.parse(request.body); const item = await ProjectDocument.findOne({ _id: String(request.params.documentId), ...scope }); if (!item) throw new HttpError(404, "Document not found"); if (item.approvalStatus === "submitted" || item.approvalStatus === "approved") throw new HttpError(409, "A new version cannot be added while approval is pending or approved"); const nextVersion = item.currentVersion + 1; item.versions.push({ version: nextVersion, ...input, uploadedBy: new mongoose.Types.ObjectId(auth.userId), uploadedAt: new Date() }); item.currentVersion = nextVersion; item.approvalStatus = "draft"; await runProjectMutationWithEvent({ organizationId: auth.organizationId, projectId: String(request.params.projectId), actorId: auth.userId, eventType: "documents.version_added", targetType: "document", targetId: String(item._id), summary: `Document version ${nextVersion} added` }, (session) => item.save(session ? { session } : {})); response.status(201).json({ success: true, data: item }); });
export const updateDocumentApproval = asyncHandler(async (request: Request, response: Response) => { const { auth, scope } = await projectContext(request); const input = documentApprovalSchema.parse(request.body); const item = await ProjectDocument.findOne({ _id: String(request.params.documentId), ...scope }); if (!item) throw new HttpError(404, "Document not found"); const next = input.action; if (next === "submitted") { if (item.currentVersion < 1) throw new HttpError(409, "Upload a document file or register an HTTPS version before submitting for approval"); transition(item.approvalStatus, next, { draft: ["submitted"], rejected: ["submitted"], revision_requested: ["submitted"] }, "document approval"); } else transition(item.approvalStatus, next, { submitted: ["approved", "rejected", "revision_requested"] }, "document approval"); item.approvalStatus = next; item.approvalHistory.push({ action: next, comment: input.comment ?? "", actorId: new mongoose.Types.ObjectId(auth.userId), actedAt: new Date() }); await runProjectMutationWithEvent({ organizationId: auth.organizationId, projectId: String(request.params.projectId), actorId: auth.userId, eventType: "documents.approval_changed", targetType: "document", targetId: String(item._id), summary: "Document approval status changed" }, (session) => item.save(session ? { session } : {})); response.json({ success: true, data: item }); });


export const uploadDocumentFile = asyncHandler(async (request: Request, response: Response) => {
  const { auth, scope } = await projectContext(request);
  if (getCollaborationTransactionStatus() !== "enabled") throw new HttpError(503, "Secure document uploads require MongoDB replica-set or sharded-cluster transactions");
  const member = await ProjectMembership.findOne({ ...scope, userId: auth.userId, status: "active" }).select("role").lean();
  if (!member || (member.role !== "project_manager" && !["owner", "admin"].includes(auth.role))) throw new HttpError(403, "Project manager access is required to upload documents");
  const documentId = String(request.params.documentId);
  if (!mongoose.isValidObjectId(documentId)) throw new HttpError(404, "Document not found");
  const normalized = normalizeDocumentFile(request.body, request.header("x-file-name"), request.header("content-type"));
  await scanDocumentWithClamAv(normalized.buffer);
  const storageKey = randomUUID();
  const sha256 = createHash("sha256").update(normalized.buffer).digest("hex");
  await putDocumentObject(storageKey, normalized.buffer, normalized.contentType);
  try {
    const assetId = new mongoose.Types.ObjectId();
    const result = await runProjectMutationWithEvent({
      organizationId: auth.organizationId, projectId: String(request.params.projectId), actorId: auth.userId,
      eventType: "documents.version_added", targetType: "document", targetId: documentId,
      summary: "A malware-scanned document version was uploaded",
    }, async (session) => {
      const query = ProjectDocument.findOne({ _id: documentId, ...scope });
      if (session) query.session(session);
      const item = await query;
      if (!item) throw new HttpError(404, "Document not found");
      if (item.approvalStatus === "submitted" || item.approvalStatus === "approved") throw new HttpError(409, "A new version cannot be added while approval is pending or approved");
      const version = item.currentVersion + 1;
      const asset = new DocumentAsset({
        _id: assetId, ...scope, documentId: item._id, version, storageKey,
        fileName: normalized.fileName, contentType: normalized.contentType,
        byteSize: normalized.buffer.length, sha256, scanStatus: "clean", uploadedBy: auth.userId,
      });
      await asset.save(session ? { session } : {});
      item.versions.push({
        version, fileAssetId: asset._id,
        fileUrl: `/projects/${request.params.projectId}/delivery/documents/${item._id}/files/${asset._id}/download`,
        fileName: normalized.fileName, checksum: sha256, notes: "Malware scan passed",
        uploadedBy: new mongoose.Types.ObjectId(auth.userId), uploadedAt: new Date(),
      });
      item.currentVersion = version;
      item.approvalStatus = "draft";
      await item.save(session ? { session } : {});
      await DocumentAuditEvent.create([{
        ...scope, documentId: item._id, assetId: asset._id, actorId: auth.userId,
        action: "uploaded", fileName: normalized.fileName, sha256,
        requestId: String(response.locals.requestId ?? ""),
      }], session ? { session } : {});
      return item;
    });
    response.status(201).json({ success: true, data: result, asset: { id: String(assetId), fileName: normalized.fileName, contentType: normalized.contentType, byteSize: normalized.buffer.length, sha256, scanStatus: "clean" } });
  } catch (error) {
    await deleteDocumentObject(storageKey).catch(() => undefined);
    throw error;
  }
});


export const createDocumentUpload = asyncHandler(async (request: Request, response: Response) => {
  const { auth, scope } = await projectContext(request);
  if (getCollaborationTransactionStatus() !== "enabled") throw new HttpError(503, "Resumable uploads require MongoDB replica-set or sharded-cluster transactions");
  await requireDocumentUploadManager(scope, auth.userId, auth.role);
  const input = createDocumentUploadSchema.parse(request.body);
  const documentId = String(request.params.documentId);
  if (!mongoose.isValidObjectId(documentId)) throw new HttpError(404, "Document not found");
  const document = await ProjectDocument.findOne({ _id: documentId, ...scope }).select("_id approvalStatus").lean();
  if (!document) throw new HttpError(404, "Document not found");
  if (document.approvalStatus === "submitted" || document.approvalStatus === "approved") throw new HttpError(409, "A new version cannot be added while approval is pending or approved");
  const expectedParts = Math.ceil(input.totalBytes / DOCUMENT_UPLOAD_PART_BYTES);
  const session = await DocumentUploadSession.create({
    ...scope, documentId, createdBy: auth.userId, fileName: input.fileName,
    contentType: input.contentType, totalBytes: input.totalBytes,
    expectedSha256: input.sha256, expectedParts, parts: [],
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  response.status(201).json({ success: true, data: { uploadId: String(session._id), partSize: DOCUMENT_UPLOAD_PART_BYTES, expectedParts, expiresAt: session.expiresAt, receivedParts: [] } });
});


export const getDocumentUpload = asyncHandler(async (request: Request, response: Response) => {
  const { auth, scope } = await projectContext(request);
  await requireDocumentUploadManager(scope, auth.userId, auth.role);
  const uploadId = String(request.params.uploadId);
  if (!mongoose.isValidObjectId(uploadId)) throw new HttpError(404, "Upload session not found");
  const session = await DocumentUploadSession.findOne({ _id: uploadId, ...scope, createdBy: auth.userId, status: { $in: ["uploading", "completing"] } }).lean();
  if (!session) throw new HttpError(404, "Upload session not found");
  if (session.expiresAt.getTime() <= Date.now()) throw new HttpError(410, "Upload session has expired");
  response.json({ success: true, data: { uploadId: String(session._id), status: session.status, fileName: session.fileName, totalBytes: session.totalBytes, partSize: DOCUMENT_UPLOAD_PART_BYTES, expectedParts: session.expectedParts, receivedParts: session.parts.map((part) => ({ partNumber: part.partNumber, byteSize: part.byteSize, sha256: part.sha256 })), expiresAt: session.expiresAt } });
});

export const uploadDocumentPart = asyncHandler(async (request: Request, response: Response) => {
  const { auth, scope } = await projectContext(request);
  await requireDocumentUploadManager(scope, auth.userId, auth.role);
  const uploadId = String(request.params.uploadId);
  if (!mongoose.isValidObjectId(uploadId)) throw new HttpError(404, "Upload session not found");
  const input = documentUploadPartSchema.parse({ partNumber: request.params.partNumber, sha256: request.header("x-part-sha256") });
  if (!Buffer.isBuffer(request.body) || request.body.length === 0 || request.body.length > DOCUMENT_UPLOAD_PART_BYTES) throw new HttpError(400, "A non-empty upload part of at most 5 MiB is required");
  const actualSha256 = createHash("sha256").update(request.body).digest("hex");
  if (actualSha256 !== input.sha256) throw new HttpError(422, "Upload part checksum verification failed");
  const session = await DocumentUploadSession.findOne({ _id: uploadId, ...scope, createdBy: auth.userId, status: "uploading" });
  if (!session) throw new HttpError(404, "Upload session not found");
  if (session.expiresAt.getTime() <= Date.now()) throw new HttpError(410, "Upload session has expired");
  if (input.partNumber > session.expectedParts) throw new HttpError(400, "Upload part number exceeds the expected part count");
  const expectedSize = input.partNumber === session.expectedParts ? session.totalBytes - (session.expectedParts - 1) * DOCUMENT_UPLOAD_PART_BYTES : DOCUMENT_UPLOAD_PART_BYTES;
  if (request.body.length !== expectedSize) throw new HttpError(400, "Upload part size does not match the expected chunk size");
  const existing = session.parts.find((part) => part.partNumber === input.partNumber);
  if (existing) {
    if (existing.sha256 === actualSha256 && existing.byteSize === request.body.length) { response.json({ success: true, data: { partNumber: input.partNumber, received: true, idempotent: true } }); return; }
    throw new HttpError(409, "This upload part was already received with different content");
  }
  const storageKey = `part_${randomUUID()}`;
  await putDocumentObject(storageKey, request.body, "application/octet-stream");
  const updated = await DocumentUploadSession.findOneAndUpdate(
    { _id: session._id, ...scope, createdBy: auth.userId, status: "uploading", expiresAt: { $gt: new Date() }, "parts.partNumber": { $ne: input.partNumber } },
    { $push: { parts: { partNumber: input.partNumber, storageKey, byteSize: request.body.length, sha256: actualSha256 } } },
    { new: true },
  );
  if (!updated) {
    await deleteDocumentObject(storageKey).catch(() => undefined);
    const latest = await DocumentUploadSession.findOne({ _id: uploadId, ...scope, createdBy: auth.userId, status: "uploading" }).lean();
    const raced = latest?.parts.find((part) => part.partNumber === input.partNumber);
    if (raced?.sha256 === actualSha256 && raced.byteSize === request.body.length) { response.json({ success: true, data: { partNumber: input.partNumber, received: true, idempotent: true } }); return; }
    throw new HttpError(409, "Upload session changed; retry the part");
  }
  response.status(201).json({ success: true, data: { partNumber: input.partNumber, received: true, idempotent: false } });
});

export const completeDocumentUpload = asyncHandler(async (request: Request, response: Response) => {
  const { auth, scope } = await projectContext(request);
  if (getCollaborationTransactionStatus() !== "enabled") throw new HttpError(503, "Resumable uploads require MongoDB replica-set or sharded-cluster transactions");
  await requireDocumentUploadManager(scope, auth.userId, auth.role);
  const uploadId = String(request.params.uploadId);
  if (!mongoose.isValidObjectId(uploadId)) throw new HttpError(404, "Upload session not found");
  const session = await DocumentUploadSession.findOne({ _id: uploadId, ...scope, createdBy: auth.userId, status: "uploading" });
  if (!session) throw new HttpError(404, "Upload session not found");
  if (session.expiresAt.getTime() <= Date.now()) throw new HttpError(410, "Upload session has expired");
  const parts = [...session.parts].sort((a, b) => a.partNumber - b.partNumber);
  if (parts.length !== session.expectedParts || parts.some((part, index) => part.partNumber !== index + 1)) throw new HttpError(409, "Upload is incomplete; all parts must be received before completion");
  if (parts.reduce((total, part) => total + part.byteSize, 0) !== session.totalBytes) throw new HttpError(409, "Upload part sizes do not match the declared file size");
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const chunk = await readDocumentObject(part.storageKey);
    if (chunk.length !== part.byteSize || createHash("sha256").update(chunk).digest("hex") !== part.sha256) throw new HttpError(503, "Stored upload part integrity check failed");
    chunks.push(chunk);
  }
  const combined = Buffer.concat(chunks, session.totalBytes);
  const sha256 = createHash("sha256").update(combined).digest("hex");
  if (session.expectedSha256 && session.expectedSha256 !== sha256) throw new HttpError(422, "Completed file checksum verification failed");
  const normalized = normalizeDocumentFile(combined, encodeURIComponent(session.fileName), session.contentType);
  await scanDocumentWithClamAv(normalized.buffer);
  const storageKey = randomUUID();
  const lockedSession = await DocumentUploadSession.findOneAndUpdate({ _id: session._id, ...scope, createdBy: auth.userId, status: "uploading", expiresAt: { $gt: new Date() } }, { $set: { status: "completing" } }, { new: true });
  if (!lockedSession) throw new HttpError(409, "Upload session is already being completed or has changed");
  try {
    await putDocumentObject(storageKey, normalized.buffer, normalized.contentType);
    const assetId = new mongoose.Types.ObjectId();
    const result = await runProjectMutationWithEvent({
      organizationId: auth.organizationId, projectId: String(request.params.projectId), actorId: auth.userId,
      eventType: "documents.version_added", targetType: "document", targetId: String(session.documentId),
      summary: "A malware-scanned resumable document upload was completed",
    }, async (transaction) => {
      const query = ProjectDocument.findOne({ _id: session.documentId, ...scope });
      if (transaction) query.session(transaction);
      const item = await query;
      if (!item) throw new HttpError(404, "Document not found");
      if (item.approvalStatus === "submitted" || item.approvalStatus === "approved") throw new HttpError(409, "A new version cannot be added while approval is pending or approved");
      const version = item.currentVersion + 1;
      const asset = new DocumentAsset({ _id: assetId, ...scope, documentId: item._id, version, storageKey, fileName: normalized.fileName, contentType: normalized.contentType, byteSize: normalized.buffer.length, sha256, scanStatus: "clean", uploadedBy: auth.userId });
      await asset.save(transaction ? { session: transaction } : {});
      item.versions.push({ version, fileAssetId: asset._id, fileUrl: `/projects/${request.params.projectId}/delivery/documents/${item._id}/files/${asset._id}/download`, fileName: normalized.fileName, checksum: sha256, notes: "Malware scan passed; resumable upload", uploadedBy: new mongoose.Types.ObjectId(auth.userId), uploadedAt: new Date() });
      item.currentVersion = version;
      item.approvalStatus = "draft";
      await item.save(transaction ? { session: transaction } : {});
      await DocumentAuditEvent.create([{ ...scope, documentId: item._id, assetId: asset._id, actorId: auth.userId, action: "uploaded", fileName: normalized.fileName, sha256, requestId: String(response.locals.requestId ?? "") }], transaction ? { session: transaction } : {});
      return item;
    });
    await Promise.all(parts.map((part) => deleteDocumentObject(part.storageKey).catch(() => undefined)));
    await DocumentUploadSession.deleteOne({ _id: session._id, ...scope, createdBy: auth.userId });
    response.status(201).json({ success: true, data: result, asset: { id: String(assetId), fileName: normalized.fileName, contentType: normalized.contentType, byteSize: normalized.buffer.length, sha256, scanStatus: "clean" } });
  } catch (error) {
    await deleteDocumentObject(storageKey).catch(() => undefined);
    await DocumentUploadSession.updateOne({ _id: session._id, ...scope, createdBy: auth.userId, status: "completing" }, { $set: { status: "uploading" } }).catch(() => undefined);
    throw error;
  }
});

export const abortDocumentUpload = asyncHandler(async (request: Request, response: Response) => {
  const { auth, scope } = await projectContext(request);
  await requireDocumentUploadManager(scope, auth.userId, auth.role);
  const uploadId = String(request.params.uploadId);
  if (!mongoose.isValidObjectId(uploadId)) throw new HttpError(404, "Upload session not found");
  const session = await DocumentUploadSession.findOne({ _id: uploadId, ...scope, createdBy: auth.userId, status: "uploading" });
  if (!session) throw new HttpError(404, "Upload session not found");
  await Promise.all(session.parts.map((part) => deleteDocumentObject(part.storageKey).catch(() => undefined)));
  await DocumentUploadSession.deleteOne({ _id: session._id, ...scope, createdBy: auth.userId });
  response.status(204).end();
});

export const downloadDocumentFile = asyncHandler(async (request: Request, response: Response) => {
  const { auth, scope } = await projectContext(request);
  const member = await ProjectMembership.exists({ ...scope, userId: auth.userId, status: "active" });
  if (!member) throw new HttpError(403, "Active project membership is required to access project documents");
  const documentId = String(request.params.documentId);
  const assetId = String(request.params.assetId);
  if (!mongoose.isValidObjectId(documentId) || !mongoose.isValidObjectId(assetId)) throw new HttpError(404, "Document file not found");
  const [document, asset] = await Promise.all([
    ProjectDocument.exists({ _id: documentId, ...scope }),
    DocumentAsset.findOne({ _id: assetId, documentId, ...scope, scanStatus: "clean" }).lean(),
  ]);
  if (!document || !asset) throw new HttpError(404, "Document file not found");
  let fileBuffer: Buffer;
  try {
    fileBuffer = await readDocumentObject(asset.storageKey);
    if (fileBuffer.length !== asset.byteSize) throw new HttpError(503, "Stored document integrity check failed");
    if (createHash("sha256").update(fileBuffer).digest("hex") !== asset.sha256) throw new HttpError(503, "Stored document checksum verification failed");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(404, "Stored document file is unavailable");
  }
  await DocumentAuditEvent.create({
    ...scope, documentId, assetId: asset._id, actorId: auth.userId,
    action: "download_authorized", fileName: asset.fileName, sha256: asset.sha256,
    requestId: String(response.locals.requestId ?? ""),
  });
  response.setHeader("Content-Type", asset.contentType);
  response.setHeader("Content-Length", String(asset.byteSize));
  response.setHeader("Content-Disposition", `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`);
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(fileBuffer);
});
