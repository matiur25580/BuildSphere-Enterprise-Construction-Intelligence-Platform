import type { Request, Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
import { documentStorageDirectory, normalizeDocumentFile, scanDocumentWithClamAv } from "./document-storage.js";
import { getCollaborationTransactionStatus } from "../collaboration/collaboration.service.js";
import { runProjectMutationWithEvent } from "../collaboration/collaboration.service.js";
import { createInspectionSchema, inspectionStatusSchema, createNcrSchema, ncrStatusSchema, createCapaSchema, capaStatusSchema, createSafetyEventSchema, safetyStatusSchema, createRfiSchema, respondRfiSchema, createSubmittalSchema, reviewSubmittalSchema, createDocumentSchema, addDocumentVersionSchema, documentApprovalSchema } from "./delivery.schemas.js";

const authContext = (request: Request) => { if (!request.auth) throw new HttpError(401, "Authentication required"); return request.auth; };
const projectContext = async (request: Request) => {
  const auth = authContext(request); const projectId = String(request.params.projectId);
  if (!mongoose.isValidObjectId(projectId)) throw new HttpError(404, "Project not found");
  const project = await Project.findOne({ _id: projectId, organizationId: auth.organizationId }).select("_id startDate targetEndDate");
  if (!project) throw new HttpError(404, "Project not found");
  return { auth, projectId, scope: { organizationId: auth.organizationId, projectId } };
};
const transition = (current: string, next: string, allowed: Record<string, string[]>, label: string) => { if (!allowed[current]?.includes(next)) throw new HttpError(409, `Cannot move ${label} from ${current} to ${next}`); };

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
  const storageDirectory = documentStorageDirectory();
  const filePath = join(storageDirectory, storageKey);
  const sha256 = createHash("sha256").update(normalized.buffer).digest("hex");
  await mkdir(storageDirectory, { recursive: true, mode: 0o700 });
  await writeFile(filePath, normalized.buffer, { flag: "wx", mode: 0o600 });
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
        fileUrl: `/api/v1/projects/${request.params.projectId}/delivery/documents/${item._id}/files/${asset._id}/download`,
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
    await unlink(filePath).catch(() => undefined);
    throw error;
  }
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
  const filePath = join(documentStorageDirectory(), asset.storageKey);
  try {
    const fileStats = await stat(filePath);
    if (fileStats.size !== asset.byteSize) throw new HttpError(503, "Stored document integrity check failed");
    const digest = createHash("sha256");
    await new Promise<void>((resolve, reject) => {
      const verifier = createReadStream(filePath);
      verifier.on("data", (chunk) => { digest.update(chunk); });
      verifier.on("end", resolve);
      verifier.on("error", reject);
    });
    if (digest.digest("hex") !== asset.sha256) throw new HttpError(503, "Stored document checksum verification failed");
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
  const stream = createReadStream(filePath);
  stream.on("error", () => response.destroy());
  stream.pipe(response);
});
