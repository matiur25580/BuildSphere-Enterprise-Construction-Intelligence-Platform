import { createConnection } from "node:net";
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

export const normalizeDocumentFile = (body: unknown, rawName: string | undefined, contentType: string | undefined) => {
  if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(400, "A non-empty document file is required");
  if (body.length > MAX_FILE_BYTES) throw new HttpError(413, "Document files are limited to 25 MB");
  if (!rawName || rawName.length > 720) throw new HttpError(400, "A valid x-file-name header is required");
  let decodedName: string;
  try { decodedName = decodeURIComponent(rawName); } catch { throw new HttpError(400, "Invalid file name encoding"); }
  const fileName = basename(decodedName.replace(/\\\\/g, "/")).replace(/[\\u0000-\\u001f\\u007f]/g, "").trim().slice(0, 180);
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
      socket.write(Buffer.from("zINSTREAM\\0", "binary"));
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
    socket.on("connect", () => socket.write(Buffer.from("zPING\\0", "binary")));
  });
};

export const documentStorageDirectory = () => process.env.DOCUMENT_STORAGE_DIR ?? "/var/lib/buildsphere/documents";
export const maxDocumentFileBytes = MAX_FILE_BYTES;
