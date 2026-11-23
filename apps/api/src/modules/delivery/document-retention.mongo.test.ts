import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { DocumentRetentionPolicy } from "./document-retention-policy.model.js";
import { DocumentLegalHold } from "./document-legal-hold.model.js";
import { DocumentAsset } from "./document-asset.model.js";
import { ProjectDocument } from "./project-document.model.js";
import { evaluateProjectDocumentRetention } from "./document-retention.service.js";

const mongoUri = process.env.MONGODB_URI?.replace("buildsphere_ci", "buildsphere_document_retention_ci");
before(async () => {
  if (!mongoUri) throw new Error("MONGODB_URI is required for document retention integration tests");
  await mongoose.connect(mongoUri);
  await Promise.all([DocumentRetentionPolicy.syncIndexes(), DocumentLegalHold.syncIndexes(), DocumentAsset.syncIndexes(), ProjectDocument.syncIndexes()]);
});
after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

test("retention evaluation keeps minimum versions and excludes legal-held documents", async () => {
  const organizationId = new mongoose.Types.ObjectId(); const projectId = new mongoose.Types.ObjectId(); const userId = new mongoose.Types.ObjectId();
  const heldDocumentId = new mongoose.Types.ObjectId(); const ordinaryDocumentId = new mongoose.Types.ObjectId();
  await DocumentRetentionPolicy.create({ organizationId, projectId, enabled: true, retentionDays: 365, minimumVersions: 1, reviewBeforePurgeDays: 30, updatedBy: userId });
  await ProjectDocument.create([
    { _id: heldDocumentId, organizationId, projectId, documentNo: "HOLD-01", title: "Held record", category: "Contract", currentVersion: 2, versions: [], createdBy: userId },
    { _id: ordinaryDocumentId, organizationId, projectId, documentNo: "DOC-01", title: "Ordinary record", category: "Drawing", currentVersion: 2, versions: [], createdBy: userId },
  ]);
  const old = new Date(Date.now() - 800 * 86400000); const newer = new Date(Date.now() - 700 * 86400000); const recent = new Date(Date.now() - 30 * 86400000);
  const makeAsset = (documentId: mongoose.Types.ObjectId, version: number, createdAt: Date) => ({ organizationId, projectId, documentId, version, storageKey: new mongoose.Types.ObjectId().toString(), fileName: "record-v" + version + ".pdf", contentType: "application/pdf", byteSize: 120, sha256: String(version).repeat(64), scanStatus: "clean", uploadedBy: userId, createdAt, updatedAt: createdAt });
  await DocumentAsset.create([makeAsset(heldDocumentId, 1, old), makeAsset(heldDocumentId, 2, recent), makeAsset(ordinaryDocumentId, 1, old), makeAsset(ordinaryDocumentId, 2, newer)]);
  await DocumentLegalHold.create({ organizationId, projectId, documentId: heldDocumentId, reference: "CASE-2026-01", reason: "Preserve all contract records for dispute review.", status: "active", createdBy: userId });
  const result = await evaluateProjectDocumentRetention({ organizationId: String(organizationId), projectId: String(projectId) });
  assert.equal(result.protectedByLegalHold, 2); assert.equal(result.retainedAsRecentVersion, 1);
  assert.equal(result.eligibleForReview.length, 1); assert.equal(result.eligibleForReview[0].documentNo, "DOC-01"); assert.equal(result.eligibleForReview[0].version, 1);
});
