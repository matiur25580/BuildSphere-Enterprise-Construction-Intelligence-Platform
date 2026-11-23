import { DocumentAsset } from "./document-asset.model.js";
import { ProjectDocument } from "./project-document.model.js";
import { DocumentLegalHold } from "./document-legal-hold.model.js";
import { DocumentRetentionPolicy } from "./document-retention-policy.model.js";

export type RetentionCandidate = { assetId: string; documentId: string; documentNo: string; version: number; fileName: string; createdAt: Date; reviewAfter: Date };
export type RetentionEvaluation = { enabled: boolean; retentionDays: number; minimumVersions: number; evaluatedAt: Date; protectedByLegalHold: number; retainedAsRecentVersion: number; eligibleForReview: RetentionCandidate[] };

export const evaluateProjectDocumentRetention = async (scope: { organizationId: string; projectId: string }, now = new Date()): Promise<RetentionEvaluation> => {
  const policy = await DocumentRetentionPolicy.findOne(scope).lean();
  const retentionDays = policy?.retentionDays ?? 2555;
  const minimumVersions = policy?.minimumVersions ?? 1;
  const result: RetentionEvaluation = { enabled: policy?.enabled ?? false, retentionDays, minimumVersions, evaluatedAt: now, protectedByLegalHold: 0, retainedAsRecentVersion: 0, eligibleForReview: [] };
  if (!policy?.enabled) return result;
  const [documents, assets, holds] = await Promise.all([
    ProjectDocument.find(scope).select("_id documentNo").lean(),
    DocumentAsset.find(scope).sort({ documentId: 1, createdAt: -1, version: -1 }).lean(),
    DocumentLegalHold.find({ ...scope, status: "active" }).select("documentId").lean(),
  ]);
  const documentById = new Map(documents.map((document) => [String(document._id), document]));
  const heldDocumentIds = new Set(holds.map((hold) => String(hold.documentId)));
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const versionsByDocument = new Map<string, typeof assets>();
  for (const asset of assets) { const key = String(asset.documentId); const current = versionsByDocument.get(key) ?? []; current.push(asset); versionsByDocument.set(key, current); }
  for (const [documentId, versions] of versionsByDocument) {
    if (heldDocumentIds.has(documentId)) { result.protectedByLegalHold += versions.length; continue; }
    versions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.version - a.version);
    versions.forEach((asset, index) => {
      if (index < minimumVersions) { result.retainedAsRecentVersion += 1; return; }
      if (asset.createdAt > cutoff) return;
      const document = documentById.get(documentId); if (!document) return;
      result.eligibleForReview.push({ assetId: String(asset._id), documentId, documentNo: document.documentNo, version: asset.version, fileName: asset.fileName, createdAt: asset.createdAt, reviewAfter: new Date(asset.createdAt.getTime() + retentionDays * 24 * 60 * 60 * 1000) });
    });
  }
  return result;
};
