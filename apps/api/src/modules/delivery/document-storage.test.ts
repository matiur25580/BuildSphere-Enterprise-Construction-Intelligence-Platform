import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertDocumentStorageConfigured, deleteDocumentFile, documentStorageDirectory, documentStorageHealthCheck, documentStorageHealthTimeoutMs, normalizeDocumentFile, readDocumentFile, storeDocumentFile } from "./document-storage.js";

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

test("storage configuration fails closed in production and local storage passes readiness", async () => {
  assert.doesNotThrow(() => assertDocumentStorageConfigured());
  await documentStorageHealthCheck();

  delete process.env.DOCUMENT_STORAGE_PROVIDER;
  process.env.NODE_ENV = "production";
  assert.throws(() => assertDocumentStorageConfigured());

  process.env.NODE_ENV = "test";
  process.env.DOCUMENT_STORAGE_PROVIDER = "unsupported";
  assert.throws(() => assertDocumentStorageConfigured());

  process.env.DOCUMENT_STORAGE_PROVIDER = "local";
  assert.doesNotThrow(() => assertDocumentStorageConfigured());
});


test("S3 readiness timeout defaults safely and validates configured bounds", () => {
  const previousTimeout = process.env.DOCUMENT_STORAGE_HEALTH_TIMEOUT_MS;
  try {
    delete process.env.DOCUMENT_STORAGE_HEALTH_TIMEOUT_MS;
    assert.equal(documentStorageHealthTimeoutMs(), 3_000);

    process.env.DOCUMENT_STORAGE_HEALTH_TIMEOUT_MS = "7500";
    assert.equal(documentStorageHealthTimeoutMs(), 7_500);

    for (const invalid of ["0", "499", "30001", "1.5", "not-a-number"]) {
      process.env.DOCUMENT_STORAGE_HEALTH_TIMEOUT_MS = invalid;
      assert.throws(() => documentStorageHealthTimeoutMs());
    }
  } finally {
    if (previousTimeout === undefined) delete process.env.DOCUMENT_STORAGE_HEALTH_TIMEOUT_MS;
    else process.env.DOCUMENT_STORAGE_HEALTH_TIMEOUT_MS = previousTimeout;
  }
});

test("S3 readiness aborts a stalled HeadBucket request and reports a safe 503", async () => {
  const previousS3 = {
    provider: process.env.DOCUMENT_STORAGE_PROVIDER,
    endpoint: process.env.DOCUMENT_S3_ENDPOINT,
    region: process.env.DOCUMENT_S3_REGION,
    bucket: process.env.DOCUMENT_S3_BUCKET,
    accessKey: process.env.DOCUMENT_S3_ACCESS_KEY_ID,
    secretKey: process.env.DOCUMENT_S3_SECRET_ACCESS_KEY,
    forcePathStyle: process.env.DOCUMENT_S3_FORCE_PATH_STYLE,
    timeout: process.env.DOCUMENT_STORAGE_HEALTH_TIMEOUT_MS,
  };
  let responseClosed = false;
  let resolveResponseClosed!: () => void;
  const responseClosedPromise = new Promise<void>((resolve) => { resolveResponseClosed = resolve; });
  const server = createServer((_request, response) => {
    response.on("close", () => {
      responseClosed = true;
      resolveResponseClosed();
    });
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    process.env.DOCUMENT_STORAGE_PROVIDER = "s3";
    process.env.DOCUMENT_S3_ENDPOINT = `http://127.0.0.1:${address.port}`;
    process.env.DOCUMENT_S3_REGION = "us-east-1";
    process.env.DOCUMENT_S3_BUCKET = "buildsphere-test";
    process.env.DOCUMENT_S3_ACCESS_KEY_ID = "test-access-key";
    process.env.DOCUMENT_S3_SECRET_ACCESS_KEY = "test-secret-key";
    process.env.DOCUMENT_S3_FORCE_PATH_STYLE = "true";
    process.env.DOCUMENT_STORAGE_HEALTH_TIMEOUT_MS = "500";

    await assert.rejects(
      documentStorageHealthCheck(),
      (error: unknown) => error instanceof Error && error.message === "S3 document storage is unavailable or misconfigured",
    );
    await Promise.race([responseClosedPromise, new Promise<void>((resolve) => setTimeout(resolve, 3_000))]);
    assert.equal(responseClosed, true, "the HTTP request should be aborted when the readiness timeout expires");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("DOCUMENT_STORAGE_PROVIDER", previousS3.provider);
    restore("DOCUMENT_S3_ENDPOINT", previousS3.endpoint);
    restore("DOCUMENT_S3_REGION", previousS3.region);
    restore("DOCUMENT_S3_BUCKET", previousS3.bucket);
    restore("DOCUMENT_S3_ACCESS_KEY_ID", previousS3.accessKey);
    restore("DOCUMENT_S3_SECRET_ACCESS_KEY", previousS3.secretKey);
    restore("DOCUMENT_S3_FORCE_PATH_STYLE", previousS3.forcePathStyle);
    restore("DOCUMENT_STORAGE_HEALTH_TIMEOUT_MS", previousS3.timeout);
  }
});
