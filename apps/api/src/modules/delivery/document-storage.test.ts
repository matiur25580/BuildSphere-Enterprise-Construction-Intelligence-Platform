import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteDocumentFile, documentStorageDirectory, normalizeDocumentFile, readDocumentFile, storeDocumentFile } from "./document-storage.js";

let directory = "";
const previous = {
  provider: process.env.DOCUMENT_STORAGE_PROVIDER,
  directory: process.env.DOCUMENT_STORAGE_DIR,
  nodeEnv: process.env.NODE_ENV,
};

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "buildsphere-storage-"));
  process.env.DOCUMENT_STORAGE_PROVIDER = "local";
  process.env.DOCUMENT_STORAGE_DIR = directory;
  process.env.NODE_ENV = "test";
});

after(async () => {
  await rm(directory, { recursive: true, force: true });
  if (previous.provider === undefined) delete process.env.DOCUMENT_STORAGE_PROVIDER; else process.env.DOCUMENT_STORAGE_PROVIDER = previous.provider;
  if (previous.directory === undefined) delete process.env.DOCUMENT_STORAGE_DIR; else process.env.DOCUMENT_STORAGE_DIR = previous.directory;
  if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
});

test("local storage provider stores, reads and deletes private document bytes", async () => {
  assert.equal(documentStorageDirectory(), directory);
  const bytes = Buffer.from("%PDF-1.7\\nprivate drawing\\n%%EOF");
  const key = "test-private-object";
  await storeDocumentFile(key, bytes, "application/pdf");
  assert.deepEqual(await readDocumentFile(key), bytes);
  await deleteDocumentFile(key);
  await assert.rejects(readDocumentFile(key));
});

test("document file normalization validates extension, content type and signature", () => {
  const bytes = Buffer.from("%PDF-1.7\\nfixture\\n%%EOF");
  const normalized = normalizeDocumentFile(bytes, "foundation-plan.pdf", "application/pdf");
  assert.equal(normalized.fileName, "foundation-plan.pdf");
  assert.equal(normalized.contentType, "application/pdf");
  assert.throws(() => normalizeDocumentFile(Buffer.from("not a PDF"), "foundation-plan.pdf", "application/pdf"));
  assert.throws(() => normalizeDocumentFile(bytes, "foundation-plan.pdf", "text/plain"));
});
