import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { createServer, type Server as TcpServer } from "node:net";
import type { Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../../app.js";
import { configureCollaborationTransactions } from "../collaboration/collaboration.service.js";
import { User } from "../users/user.model.js";
import { Organization } from "../organizations/organization.model.js";
import { Membership } from "../organizations/membership.model.js";
import { Project } from "../projects/project.model.js";
import { ProjectMembership } from "../projects/project-membership.model.js";
import { ProjectDocument } from "./project-document.model.js";
import { DocumentAsset } from "./document-asset.model.js";
import { DocumentAuditEvent } from "./document-audit.model.js";

const mongoUri = process.env.MONGODB_URI;
const isolatedMongoUri = mongoUri?.replace("buildsphere_ci", "buildsphere_documents_ci");
let httpServer: Server | undefined;
let clamdServer: TcpServer | undefined;
let baseUrl = "";
let storageDirectory = "";
if (!mongoUri) throw new Error("MONGODB_URI is required for document integration tests");

before(async () => {
  await mongoose.connect(isolatedMongoUri ?? mongoUri!);
  assert.equal(await configureCollaborationTransactions(), true, "Document integration tests require MongoDB transactions");
  await Promise.all([User.syncIndexes(), Organization.syncIndexes(), Membership.syncIndexes(), Project.syncIndexes(), ProjectMembership.syncIndexes(), ProjectDocument.syncIndexes(), DocumentAsset.syncIndexes(), DocumentAuditEvent.syncIndexes()]);
  storageDirectory = await mkdtemp(join(tmpdir(), "buildsphere-documents-"));
  process.env.DOCUMENT_STORAGE_DIR = storageDirectory;
  clamdServer = createServer((socket) => {
    let data = Buffer.alloc(0);
    let scanned = Buffer.alloc(0);
    let commandRead = false;
    socket.on("data", (chunk) => {
      data = Buffer.concat([data, chunk]);
      if (!commandRead) {
        const terminator = data.indexOf(0);
        if (terminator < 0) return;
        data = data.subarray(terminator + 1);
        commandRead = true;
      }
      while (data.length >= 4) {
        const length = data.readUInt32BE(0);
        if (length === 0) { socket.end(Buffer.from(scanned.includes(Buffer.from("EICAR")) ? "stream: Eicar-Test-Signature FOUND\\0" : "stream: OK\\0")); return; }
        if (data.length < 4 + length) return;
        scanned = Buffer.concat([scanned, data.subarray(4, 4 + length)]);
        data = data.subarray(4 + length);
      }
    });
  });
  await new Promise<void>((resolve) => clamdServer!.listen(0, "127.0.0.1", resolve));
  const scannerAddress = clamdServer.address();
  assert.ok(scannerAddress && typeof scannerAddress !== "string");
  process.env.CLAMD_HOST = "127.0.0.1";
  process.env.CLAMD_PORT = String(scannerAddress.port);
  httpServer = app.listen(0);
  await new Promise<void>((resolve) => httpServer!.once("listening", resolve));
  const address = httpServer.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (httpServer) await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
  if (clamdServer) await new Promise<void>((resolve) => clamdServer!.close(() => resolve()));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
});

test("private document upload and download enforce scan, tenant and project-member boundaries", async () => {
  const secret = process.env.JWT_ACCESS_SECRET;
  assert.ok(secret && secret.length >= 32);
  const [owner, viewer, inactive, tenantB] = await User.create([
    { name: "Document Owner", email: "document-owner@example.test", passwordHash: "test-hash" },
    { name: "Document Viewer", email: "document-viewer@example.test", passwordHash: "test-hash" },
    { name: "Inactive Project Member", email: "document-inactive@example.test", passwordHash: "test-hash" },
    { name: "Other Tenant Owner", email: "document-other@example.test", passwordHash: "test-hash" },
  ]);
  const [orgA, orgB] = await Organization.create([
    { name: "Document Tenant A", slug: "document-tenant-a", createdBy: owner._id },
    { name: "Document Tenant B", slug: "document-tenant-b", createdBy: tenantB._id },
  ]);
  await Membership.create([
    { userId: owner._id, organizationId: orgA._id, role: "owner", status: "active" },
    { userId: viewer._id, organizationId: orgA._id, role: "member", status: "active" },
    { userId: inactive._id, organizationId: orgA._id, role: "member", status: "active" },
    { userId: tenantB._id, organizationId: orgB._id, role: "owner", status: "active" },
  ]);
  const project = await Project.create({
    organizationId: orgA._id, code: "DOC-1", name: "Document security test",
    startDate: new Date("2026-01-01"), targetEndDate: new Date("2027-01-01"), createdBy: owner._id,
  });
  await ProjectMembership.create([
    { organizationId: orgA._id, projectId: project._id, userId: owner._id, role: "project_manager", status: "active", addedBy: owner._id },
    { organizationId: orgA._id, projectId: project._id, userId: viewer._id, role: "viewer", status: "active", addedBy: owner._id },
    { organizationId: orgA._id, projectId: project._id, userId: inactive._id, role: "contributor", status: "inactive", addedBy: owner._id },
  ]);
  const document = await ProjectDocument.create({
    organizationId: orgA._id, projectId: project._id, documentNo: "DWG-001",
    title: "Foundation general arrangement", category: "Drawing", currentVersion: 0, versions: [],
    approvalStatus: "draft", createdBy: owner._id,
  });
  const token = (userId: string, organizationId: string, role: string) => jwt.sign({ organizationId, role }, secret, { subject: userId, expiresIn: "5m" });
  const ownerToken = token(String(owner._id), String(orgA._id), "owner");
  const viewerToken = token(String(viewer._id), String(orgA._id), "member");
  const inactiveToken = token(String(inactive._id), String(orgA._id), "member");
  const tenantBToken = token(String(tenantB._id), String(orgB._id), "owner");
  const path = `/api/v1/projects/${project._id}/delivery/documents/${document._id}/files`;
  const pdf = Buffer.from("%PDF-1.7\\nBuildSphere controlled drawing\\n%%EOF");
  const approvalUrl = `${baseUrl}/api/v1/projects/${project._id}/delivery/documents/${document._id}/approval`;
  assert.equal((await fetch(approvalUrl, { method: "PATCH", headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" }, body: JSON.stringify({ action: "submitted" }) })).status, 409);
  const upload = (bearer: string, body = pdf, contentType = "application/pdf", fileName = "foundation-plan.pdf") =>
    fetch(baseUrl + path, { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": contentType, "x-file-name": encodeURIComponent(fileName) }, body });
  assert.equal((await upload(ownerToken)).status, 201);
  assert.equal((await upload(viewerToken)).status, 403);
  assert.equal((await upload(ownerToken, Buffer.from("not a PDF"))).status, 415);
  assert.equal((await upload(ownerToken, Buffer.from("%PDF-1.7\\nEICAR test signature\\n%%EOF"))).status, 422);
  const scannerPort = process.env.CLAMD_PORT;
  process.env.CLAMD_PORT = "1";
  assert.equal((await upload(ownerToken)).status, 503);
  process.env.CLAMD_PORT = scannerPort;
  const saved = await ProjectDocument.findById(document._id).lean();
  assert.equal(saved?.currentVersion, 1);
  assert.equal(saved?.versions[0]?.fileName, "foundation-plan.pdf");
  const asset = await DocumentAsset.findOne({ documentId: document._id }).lean();
  assert.ok(asset);
  assert.equal(asset.scanStatus, "clean");
  assert.equal(asset.byteSize, pdf.length);
  const downloadPath = `${path}/${asset._id}/download`;
  assert.equal((await fetch(baseUrl + downloadPath)).status, 401);
  const ownerDownload = await fetch(baseUrl + downloadPath, { headers: { authorization: `Bearer ${ownerToken}` } });
  assert.equal(ownerDownload.status, 200);
  assert.deepEqual(Buffer.from(await ownerDownload.arrayBuffer()), pdf);
  assert.equal((await fetch(baseUrl + downloadPath, { headers: { authorization: `Bearer ${viewerToken}` } })).status, 200);
  assert.equal((await fetch(baseUrl + downloadPath, { headers: { authorization: `Bearer ${inactiveToken}` } })).status, 403);
  assert.equal((await fetch(`${baseUrl}/api/v1/projects/${project._id}/delivery/documents/${document._id}/files/${asset._id}/download`, { headers: { authorization: `Bearer ${tenantBToken}` } })).status, 404);
  assert.equal(await DocumentAuditEvent.countDocuments({ documentId: document._id, action: "uploaded" }), 1);
  assert.equal(await DocumentAuditEvent.countDocuments({ documentId: document._id, action: "download_authorized" }), 2);
});
