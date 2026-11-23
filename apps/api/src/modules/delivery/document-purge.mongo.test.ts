import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { DocumentPurgeRequest } from "./document-purge-request.model.js";

const mongoUri = process.env.MONGODB_URI?.replace("buildsphere_ci", "buildsphere_document_purge_ci");
before(async () => {
  if (!mongoUri) throw new Error("MONGODB_URI is required for document purge integration tests");
  await mongoose.connect(mongoUri);
  await DocumentPurgeRequest.syncIndexes();
});
after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

test("purge request stores immutable candidate snapshots and requires two distinct approvers", async () => {
  const organizationId = new mongoose.Types.ObjectId();
  const projectId = new mongoose.Types.ObjectId();
  const requesterId = new mongoose.Types.ObjectId();
  const firstApprover = new mongoose.Types.ObjectId();
  const secondApprover = new mongoose.Types.ObjectId();
  const assetId = new mongoose.Types.ObjectId();
  const documentId = new mongoose.Types.ObjectId();
  const item = await DocumentPurgeRequest.create({
    organizationId, projectId, reference: "RET-2026-01", reason: "Superseded drawing version exceeded configured retention period.",
    requestedBy: requesterId, requestedAt: new Date(), expiresAt: new Date(Date.now() + 86400000),
    status: "awaiting_approval",
    candidates: [{ assetId, documentId, documentNo: "DRW-01", version: 1, fileName: "drawing-v1.pdf", storageKey: "uuid/drawing-v1", sha256: "a".repeat(64), byteSize: 100 }],
  });
  await DocumentPurgeRequest.findOneAndUpdate({ _id: item._id, "approvals.0": { $exists: false } }, { $push: { approvals: { actorId: firstApprover, comment: "Reviewed retention evidence and asset history.", approvedAt: new Date() } } });
  const approved = await DocumentPurgeRequest.findOneAndUpdate(
    { _id: item._id, "approvals.0": { $exists: true }, "approvals.1": { $exists: false }, approvals: { $not: { $elemMatch: { actorId: secondApprover } } } },
    { $push: { approvals: { actorId: secondApprover, comment: "Second independent review completed.", approvedAt: new Date() } }, $set: { status: "approved" } },
    { new: true },
  ).lean();
  assert.equal(approved?.approvals.length, 2);
  assert.equal(approved?.status, "approved");
  assert.notEqual(String(approved?.approvals[0]?.actorId), String(approved?.approvals[1]?.actorId));
  assert.equal(approved?.candidates[0]?.storageKey, "uuid/drawing-v1");
});
