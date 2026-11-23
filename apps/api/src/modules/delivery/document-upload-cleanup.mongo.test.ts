import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { mkdtemp, rm, readFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DocumentUploadSession } from "./document-upload-session.model.js";
import { DocumentAsset } from "./document-asset.model.js";
import { putDocumentObject } from "./document-storage.js";
import { reconcileExpiredDocumentUploads, reconcileOrphanDocumentObjects } from "./document-upload-cleanup.service.js";

const mongoUri = process.env.MONGODB_URI?.replace("buildsphere_ci", "buildsphere_upload_cleanup_ci");
let storageDirectory = "";

before(async () => {
  if (!mongoUri) throw new Error("MONGODB_URI is required for upload cleanup integration tests");
  await mongoose.connect(mongoUri);
  await Promise.all([DocumentUploadSession.syncIndexes(), DocumentAsset.syncIndexes()]);
  storageDirectory = await mkdtemp(join(tmpdir(), "buildsphere-upload-cleanup-"));
  process.env.DOCUMENT_STORAGE_DRIVER = "filesystem";
  process.env.DOCUMENT_STORAGE_DIR = storageDirectory;
});

after(async () => {
  await DocumentUploadSession.deleteMany({});
  await DocumentAsset.deleteMany({});
  await mongoose.disconnect();
  if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
});

test("expired sessions and abandoned completion objects are cleaned without deleting referenced assets", async () => {
  const organizationId = new mongoose.Types.ObjectId();
  const projectId = new mongoose.Types.ObjectId();
  const documentId = new mongoose.Types.ObjectId();
  const createdBy = new mongoose.Types.ObjectId();
  const expiredChunkKey = randomUUID();
  const abandonedFinalKey = randomUUID();
  const referencedFinalKey = randomUUID();
  const bytes = Buffer.from("private upload fixture");
  await Promise.all([
    putDocumentObject(expiredChunkKey, bytes, "application/octet-stream"),
    putDocumentObject(abandonedFinalKey, bytes, "application/octet-stream"),
    putDocumentObject(referencedFinalKey, bytes, "application/octet-stream"),
  ]);
  const now = new Date();
  const expired = await DocumentUploadSession.create({
    organizationId, projectId, documentId, createdBy, fileName: "expired.pdf", contentType: "application/pdf",
    totalBytes: bytes.length, expectedParts: 1, parts: [{ partNumber: 1, storageKey: expiredChunkKey, byteSize: bytes.length, sha256: "a".repeat(64) }],
    status: "uploading", expiresAt: new Date(now.getTime() - 1000),
  });
  const abandoned = await DocumentUploadSession.create({
    organizationId, projectId, documentId, createdBy, fileName: "abandoned.pdf", contentType: "application/pdf",
    totalBytes: bytes.length, expectedParts: 1, parts: [], status: "completing", finalStorageKey: abandonedFinalKey,
    expiresAt: new Date(now.getTime() + 60_000),
  });
  const referenced = await DocumentUploadSession.create({
    organizationId, projectId, documentId, createdBy, fileName: "committed.pdf", contentType: "application/pdf",
    totalBytes: bytes.length, expectedParts: 1, parts: [], status: "completing", finalStorageKey: referencedFinalKey,
    expiresAt: new Date(now.getTime() + 60_000),
  });
  await DocumentAsset.create({
    organizationId, projectId, documentId, version: 1, storageKey: referencedFinalKey, fileName: "committed.pdf",
    contentType: "application/pdf", byteSize: bytes.length, sha256: "b".repeat(64), scanStatus: "clean", uploadedBy: createdBy,
  });
  const staleTime = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  await DocumentUploadSession.updateMany({ _id: { $in: [abandoned._id, referenced._id] } }, { $set: { updatedAt: staleTime } }, { timestamps: false });

  const result = await reconcileExpiredDocumentUploads(now);
  assert.equal(result.examined, 3);
  assert.equal(result.cleaned, 3);
  assert.equal(result.retained, 0);
  await assert.rejects(readFile(join(storageDirectory, expiredChunkKey)));
  await assert.rejects(readFile(join(storageDirectory, abandonedFinalKey)));
  assert.deepEqual(await readFile(join(storageDirectory, referencedFinalKey)), bytes);
  assert.equal(await DocumentUploadSession.countDocuments({ _id: { $in: [expired._id, abandoned._id, referenced._id] } }), 0);
});

test("inventory removes only old unreferenced objects and preserves assets and recent uploads", async () => {
  const organizationId = new mongoose.Types.ObjectId();
  const projectId = new mongoose.Types.ObjectId();
  const documentId = new mongoose.Types.ObjectId();
  const uploadedBy = new mongoose.Types.ObjectId();
  const staleOrphanKey = randomUUID();
  const recentOrphanKey = randomUUID();
  const referencedKey = randomUUID();
  const bytes = Buffer.from("inventory fixture");
  await Promise.all([
    putDocumentObject(staleOrphanKey, bytes, "application/octet-stream"),
    putDocumentObject(recentOrphanKey, bytes, "application/octet-stream"),
    putDocumentObject(referencedKey, bytes, "application/octet-stream"),
  ]);
  const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await Promise.all([utimes(join(storageDirectory, staleOrphanKey), staleDate, staleDate), utimes(join(storageDirectory, referencedKey), staleDate, staleDate)]);
  await DocumentAsset.create({
    organizationId, projectId, documentId, version: 1, storageKey: referencedKey, fileName: "retained.pdf",
    contentType: "application/pdf", byteSize: bytes.length, sha256: "c".repeat(64), scanStatus: "clean", uploadedBy,
  });

  const result = await reconcileOrphanDocumentObjects(new Date());
  assert.equal(result.examined >= 3, true);
  assert.equal(result.deleted, 1);
  assert.equal(result.retained, 1);
  assert.equal(result.recent >= 1, true);
  await assert.rejects(readFile(join(storageDirectory, staleOrphanKey)));
  assert.deepEqual(await readFile(join(storageDirectory, referencedKey)), bytes);
  assert.deepEqual(await readFile(join(storageDirectory, recentOrphanKey)), bytes);
});
