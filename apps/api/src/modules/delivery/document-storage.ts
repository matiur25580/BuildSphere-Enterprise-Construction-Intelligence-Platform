import { createConnection } from "node:net";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { basename, extname } from "node:path";
import { HttpError } from "../../common/http-error.js";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ifc": "application/ifc",
};
const MAX_FILE_BYTES = 25 * 1024 * 1024;


const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const hmac = (key: Buffer | string, value: string) => createHmac("sha256", key).update(value).digest();
const awsEncode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const validStorageKey = (key: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(key);
type S3Config = { endpoint: URL; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; sessionToken?: string };
const s3Config = (): S3Config => {
  const endpointValue = process.env.S3_ENDPOINT, region = process.env.S3_REGION, bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID, secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!endpointValue || !region || !bucket || !accessKeyId || !secretAccessKey) throw new HttpError(503, "S3 document storage is not fully configured");
  let endpoint: URL;
  try { endpoint = new URL(endpointValue); } catch { throw new HttpError(503, "S3_ENDPOINT must be a valid URL"); }
  if (endpoint.protocol !== "https:" && process.env.NODE_ENV === "production") throw new HttpError(503, "S3 document storage requires HTTPS in production");
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new HttpError(503, "S3_ENDPOINT must not contain credentials, a query, or a fragment");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new HttpError(503, "S3_BUCKET must be a valid bucket name");
  return { endpoint, region, bucket, accessKeyId, secretAccessKey, sessionToken: process.env.S3_SESSION_TOKEN || undefined };
};
const signedS3Request = async (method: "PUT" | "GET" | "DELETE" | "HEAD", key?: string, body?: Buffer, contentType?: string): Promise<Response> => {
  const config = s3Config(), now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\\.\\d{3}/g, ""), dateStamp = amzDate.slice(0, 8);
  const basePath = config.endpoint.pathname.replace(/\\/$/, "");
  const objectPath = key ? `/${awsEncode(config.bucket)}/${awsEncode(key)}` : `/${awsEncode(config.bucket)}`;
  const canonicalUri = `${basePath}${objectPath}` || "/";
  const url = new URL(config.endpoint.toString()); url.pathname = canonicalUri;
  const payloadHash = digest(body ?? Buffer.alloc(0));
  const headers: Record<string,string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  if (config.sessionToken) headers["x-amz-security-token"] = config.sessionToken;
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map(name => `${name}:${headers[name].trim()}\\n`).join("");
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\\n");
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, digest(canonicalRequest)].join("\\n");
  const signature = createHmac("sha256", hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), config.region), "s3").length ? hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), config.region), "s3") : Buffer.alloc(0)).update(stringToSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const requestHeaders = new Headers(); for (const [name,value] of Object.entries(headers)) if (name !== "host") requestHeaders.set(name,value);
  try { return await fetch(url,{method,headers:requestHeaders,body:method === "PUT" ? body : undefined,signal:AbortSignal.timeout(15000)}); }
  catch { throw new HttpError(503,"S3 document storage is unavailable"); }
};
export const documentStorageDriver = () => {
  const driver=(process.env.DOCUMENT_STORAGE_DRIVER ?? "filesystem").toLowerCase();
  if(driver!=="filesystem" && driver!=="s3") throw new HttpError(503,"DOCUMENT_STORAGE_DRIVER must be filesystem or s3");
  return driver;
};
export const putDocumentObject = async (key:string,buffer:Buffer,contentType:string):Promise<void> => {
  if(!validStorageKey(key)) throw new HttpError(400,"Invalid document storage key");
  if(documentStorageDriver()==="s3"){const response=await signedS3Request("PUT",key,buffer,contentType);if(!response.ok)throw new HttpError(503,"S3 document storage rejected the upload");return;}
  const directory=documentStorageDirectory();await mkdir(directory,{recursive:true,mode:0o700});
  try{await writeFile(join(directory,key),buffer,{flag:"wx",mode:0o600});}catch{throw new HttpError(503,"Private document storage could not persist the upload");}
};
export const readDocumentObject = async (key:string):Promise<Buffer> => {
  if(!validStorageKey(key))throw new HttpError(404,"Stored document file is unavailable");
  if(documentStorageDriver()==="s3"){const response=await signedS3Request("GET",key);if(response.status===404)throw new HttpError(404,"Stored document file is unavailable");if(!response.ok)throw new HttpError(503,"S3 document storage could not read the document");const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>MAX_FILE_BYTES)throw new HttpError(503,"Stored document exceeds the configured size limit");return bytes;}
  try{return await readFile(join(documentStorageDirectory(),key));}catch{throw new HttpError(404,"Stored document file is unavailable");}
};
export const deleteDocumentObject = async (key:string):Promise<void> => {
  if(!validStorageKey(key))return;
  if(documentStorageDriver()==="s3"){const response=await signedS3Request("DELETE",key);if(!response.ok&&response.status!==404)throw new HttpError(503,"S3 document storage could not remove the object");return;}
  await unlink(join(documentStorageDirectory(),key)).catch(()=>undefined);
};
export const checkDocumentStorageHealth = async ():Promise<boolean> => {
  try{if(documentStorageDriver()==="s3")return (await signedS3Request("HEAD")).ok;const dir=documentStorageDirectory();await mkdir(dir,{recursive:true,mode:0o700});const key=`.health-${randomUUID()}`;const path=join(dir,key);await writeFile(path,"ok",{flag:"wx",mode:0o600});await unlink(path);return true;}catch{return false;}
};
export const normalizeDocumentFile = (body: unknown, rawName: string | undefined, contentType: string | undefined) => {
  if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(400, "A non-empty document file is required");
  if (body.length > MAX_FILE_BYTES) throw new HttpError(413, "Document files are limited to 25 MB");
  if (!rawName || rawName.length > 720) throw new HttpError(400, "A valid x-file-name header is required");
  let decodedName: string;
  try { decodedName = decodeURIComponent(rawName); } catch { throw new HttpError(400, "Invalid file name encoding"); }
  const fileName = basename(decodedName.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180);
  const extension = extname(fileName).toLowerCase();
  const expectedType = MIME_BY_EXTENSION[extension];
  if (!fileName || !expectedType || contentType?.split(";")[0].trim().toLowerCase() !== expectedType) {
    throw new HttpError(415, "Only matching PDF, PNG, JPEG, WEBP and IFC document files are supported");
  }
  const validSignature =
    (expectedType === "application/pdf" && body.subarray(0, 5).toString("ascii") === "%PDF-") ||
    (expectedType === "image/png" && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (expectedType === "image/jpeg" && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) ||
    (expectedType === "image/webp" && body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP") ||
    (expectedType === "application/ifc" && body.subarray(0, 256).toString("utf8").trimStart().startsWith("ISO-10303-21;"));
  if (!validSignature) throw new HttpError(415, "File content does not match its declared document type");
  return { buffer: body, fileName, contentType: expectedType };
};

export const scanDocumentWithClamAv = async (buffer: Buffer): Promise<void> => {
  const host = process.env.CLAMD_HOST;
  if (!host) throw new HttpError(503, "Document scanning is not configured; set CLAMD_HOST before accepting uploads");
  const port = Number(process.env.CLAMD_PORT ?? 3310);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(503, "CLAMD_PORT must be a valid TCP port");
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host, port });
    let response = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve();
    };
    socket.setTimeout(30_000, () => finish(new HttpError(503, "Document malware scan timed out")));
    socket.on("error", () => finish(new HttpError(503, "Document malware scanner is unavailable")));
    socket.on("data", (chunk: Buffer) => {
      response += chunk.toString("utf8");
      if (response.includes("FOUND")) finish(new HttpError(422, "Malware was detected; the document was rejected"));
      else if (response.includes("OK")) finish();
      else if (response.length > 4096) finish(new HttpError(503, "Unexpected malware scanner response"));
    });
    socket.on("connect", () => {
      socket.write(Buffer.from("zINSTREAM\0", "binary"));
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < buffer.length; offset += chunkSize) {
        const chunk = buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length));
        const header = Buffer.alloc(4);
        header.writeUInt32BE(chunk.length, 0);
        socket.write(header);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
  });
};

export const checkClamAvHealth = async (): Promise<boolean> => {
  const host = process.env.CLAMD_HOST;
  const port = Number(process.env.CLAMD_PORT ?? 3310);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return false;
  return await new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (healthy: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(healthy);
    };
    socket.setTimeout(2_000, () => finish(false));
    socket.on("error", () => finish(false));
    socket.on("data", (chunk: Buffer) => finish(chunk.toString("utf8").includes("PONG")));
    socket.on("connect", () => socket.write(Buffer.from("zPING\0", "binary")));
  });
};

export const documentStorageDirectory = () => process.env.DOCUMENT_STORAGE_DIR ?? "/var/lib/buildsphere/documents";
export const maxDocumentFileBytes = MAX_FILE_BYTES;
