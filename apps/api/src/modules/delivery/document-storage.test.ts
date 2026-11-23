import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkDocumentStorageHealth,
  deleteDocumentObject,
  documentStorageDriver,
  normalizeDocumentFile,
  putDocumentObject,
  readDocumentObject,
} from "./document-storage.js";

const envKeys = ["DOCUMENT_STORAGE_DRIVER", "DOCUMENT_STORAGE_DIR", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_SESSION_TOKEN", "NODE_ENV"] as const;
const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const restoreEnv = () => { for (const key of envKeys) { const value = savedEnv[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; } };

test("filesystem adapter persists, reads, deletes and probes private objects", async () => {
  const directory = await mkdtemp(join(tmpdir(), "buildsphere-storage-"));
  try {
    process.env.DOCUMENT_STORAGE_DRIVER = "filesystem";
    process.env.DOCUMENT_STORAGE_DIR = directory;
    const payload = Buffer.from("%PDF-1.7 test document");
    await putDocumentObject("file_123", payload, "application/pdf");
    assert.deepEqual(await readDocumentObject("file_123"), payload);
    assert.equal(await checkDocumentStorageHealth(), true);
    await deleteDocumentObject("file_123");
    await assert.rejects(readDocumentObject("file_123"));
    assert.equal(documentStorageDriver(), "filesystem");
  } finally {
    await rm(directory, { recursive: true, force: true });
    restoreEnv();
  }
});

test("S3 adapter signs private object requests and supports temporary credentials", async () => {
  const originalFetch = globalThis.fetch;
  const objects = new Map<string, Buffer>();
  const requests: Array<{ method: string; url: string; authorization: string; token?: string }> = [];
  process.env.DOCUMENT_STORAGE_DRIVER = "s3";
  process.env.NODE_ENV = "test";
  process.env.S3_ENDPOINT = "https://objects.example.test";
  process.env.S3_REGION = "us-east-1";
  process.env.S3_BUCKET = "buildsphere-private";
  process.env.S3_ACCESS_KEY_ID = "test-access";
  process.env.S3_SECRET_ACCESS_KEY = "test-secret";
  process.env.S3_SESSION_TOKEN = "temporary-session-token";
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    const token = new Headers(init?.headers).get("x-amz-security-token") ?? undefined;
    requests.push({ method, url, authorization, token });
    const key = url.split("/").pop() ?? "";
    if (method === "PUT") { objects.set(key, Buffer.from(init?.body as Uint8Array)); return new Response(null, { status: 200 }); }
    if (method === "GET") { const value = objects.get(key); return value ? new Response(value, { status: 200 }) : new Response(null, { status: 404 }); }
    if (method === "DELETE") { objects.delete(key); return new Response(null, { status: 204 }); }
    if (method === "HEAD") return new Response(null, { status: 200 });
    return new Response(null, { status: 405 });
  }) as typeof fetch;
  try {
    const payload = Buffer.from("%PDF-1.7 signed object");
    await putDocumentObject("object_456", payload, "application/pdf");
    assert.deepEqual(await readDocumentObject("object_456"), payload);
    assert.equal(await checkDocumentStorageHealth(), true);
    await deleteDocumentObject("object_456");
    assert.equal(requests.length, 4);
    for (const request of requests) {
      assert.match(request.authorization, /^AWS4-HMAC-SHA256 Credential=test-access\//);
      assert.equal(request.token, "temporary-session-token");
      assert.match(request.url, /buildsphere-private/);
    }
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("document filename normalization rejects mismatched file signatures and strips path components", () => {
  const normalized = normalizeDocumentFile(Buffer.from("%PDF-1.7 content"), encodeURIComponent("..\\private\\drawing.pdf"), "application/pdf");
  assert.equal(normalized.fileName, "drawing.pdf");
  assert.throws(() => normalizeDocumentFile(Buffer.from("not a PDF"), "drawing.pdf", "application/pdf"));
});
