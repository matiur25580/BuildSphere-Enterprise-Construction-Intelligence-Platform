import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import mongoose from "mongoose";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const uri = process.env.MONGODB_URI;
const bucket = process.env.DOCUMENT_S3_BUCKET;
const region = process.env.DOCUMENT_S3_REGION ?? process.env.AWS_REGION;
const directory = process.env.DOCUMENT_STORAGE_DIR ?? "/var/lib/buildsphere/documents";
if (!uri || !bucket || !region) throw new Error("MONGODB_URI, DOCUMENT_S3_BUCKET and DOCUMENT_S3_REGION/AWS_REGION are required");
if (process.env.DOCUMENT_STORAGE_PROVIDER === "s3") throw new Error("Run this migration while the application is still configured for local storage");
const accessKeyId = process.env.DOCUMENT_S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.DOCUMENT_S3_SECRET_ACCESS_KEY;
if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) throw new Error("Configure both S3 access key and secret");
const client = new S3Client({
  region,
  ...(process.env.DOCUMENT_S3_ENDPOINT ? { endpoint: process.env.DOCUMENT_S3_ENDPOINT } : {}),
  forcePathStyle: process.env.DOCUMENT_S3_FORCE_PATH_STYLE === "true",
  ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
});
const apply = process.argv.includes("--apply");

const migrate = async () => {
  await mongoose.connect(uri);
  try {
    const assets = mongoose.connection.collection("documentassets");
    const cursor = assets.find({}, { projection: { storageKey: 1, byteSize: 1, sha256: 1, contentType: 1 } });
    let copied = 0;
    let skipped = 0;
    for await (const asset of cursor) {
      if (typeof asset.storageKey !== "string" || typeof asset.sha256 !== "string") throw new Error("Encountered a document asset without a storage key or checksum");
      const localPath = join(directory, asset.storageKey);
      const bytes = await readFile(localPath);
      const checksum = createHash("sha256").update(bytes).digest("hex");
      if (bytes.length !== asset.byteSize || checksum !== asset.sha256) throw new Error(`Local object ${asset.storageKey} does not match its recorded size/checksum`);
      if (!apply) {
        console.info(`DRY RUN: verified ${asset.storageKey} (${bytes.length} bytes)`);
        skipped++;
        continue;
      }
      let exists = false;
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: asset.storageKey }));
        exists = true;
        if (head.ContentLength !== bytes.length || head.Metadata?.sha256 !== checksum) throw new Error(`S3 object ${asset.storageKey} already exists but does not match the local asset`);
      } catch (error) {
        if (exists) throw error;
        const name = error?.name;
        const status = error?.$metadata?.httpStatusCode;
        if (name !== "NotFound" && name !== "NoSuchKey" && name !== "404" && status !== 404) throw error;
      }
      if (!exists) {
        await client.send(new PutObjectCommand({
          Bucket: bucket, Key: asset.storageKey, Body: bytes, ContentLength: bytes.length,
          ContentType: asset.contentType, ServerSideEncryption: "AES256", Metadata: { sha256: checksum },
        }));
      }
      copied++;
      console.info(`Verified S3 object ${asset.storageKey} (${bytes.length} bytes)`);
    }
    console.info(`Document migration ${apply ? "completed" : "dry run complete"}: ${copied} copied/verified, ${skipped} dry-run records`);
    if (!apply) console.info("Re-run with --apply to upload verified objects. Keep the original local files until production downloads are validated.");
  } finally {
    await mongoose.disconnect();
    client.destroy();
  }
};

migrate().catch((error) => {
  console.error("Document object-storage migration failed:", error);
  process.exitCode = 1;
});
