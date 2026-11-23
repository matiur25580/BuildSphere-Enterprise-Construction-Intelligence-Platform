import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import { RefreshSession } from "./refresh-session.model.js";

const mongoUri = process.env.MONGODB_URI;
const isolatedMongoUri = mongoUri?.replace("buildsphere_ci", "buildsphere_auth_security_ci");
const jwtSecret = process.env.JWT_ACCESS_SECRET ?? "buildsphere-auth-security-test-secret-32chars";
let httpServer: Server | undefined;
let clamdServer: TcpServer | undefined;
let baseUrl = "";
let storageDirectory = "";
let scannerPort = 0;

if (!mongoUri) throw new Error("MONGODB_URI is required for authentication security integration tests");

const accessToken = (userId: string, organizationId: string, role: string) =>
  jwt.sign({ organizationId, role }, jwtSecret, { subject: userId, expiresIn: "5m" });
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

before(async () => {
  process.env.JWT_ACCESS_SECRET = jwtSecret;
  await mongoose.connect(isolatedMongoUri ?? mongoUri!);
  assert.equal(await configureCollaborationTransactions(), true, "Authentication security tests require MongoDB transactions");
  await Promise.all([User.syncIndexes(), Organization.syncIndexes(), Membership.syncIndexes(), RefreshSession.syncIndexes()]);
  storageDirectory = await mkdtemp(join(tmpdir(), "buildsphere-auth-security-"));
  process.env.DOCUMENT_STORAGE_DIR = storageDirectory;

  clamdServer = createServer((socket) => {
    socket.on("data", (chunk) => {
      if (chunk.includes(Buffer.from("PING"))) socket.end(Buffer.from("PONG\0"));
    });
  });
  await new Promise<void>((resolve) => clamdServer!.listen(0, "127.0.0.1", resolve));
  const address = clamdServer.address();
  assert.ok(address && typeof address !== "string");
  scannerPort = address.port;
  process.env.CLAMD_HOST = "127.0.0.1";
  process.env.CLAMD_PORT = String(scannerPort);

  httpServer = app.listen(0);
  await new Promise<void>((resolve) => httpServer!.once("listening", resolve));
  const serverAddress = httpServer.address();
  assert.ok(serverAddress && typeof serverAddress !== "string");
  baseUrl = \`http://127.0.0.1:\${serverAddress.port}\`;
});

after(async () => {
  if (httpServer) await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
  if (clamdServer) await new Promise<void>((resolve) => clamdServer!.close(() => resolve()));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
});

test("suspended organizations cannot use previously issued access tokens", async () => {
  const user = await User.create({ name: "Suspended Tenant User", email: "suspended-tenant@example.test", passwordHash: "test-hash" });
  const organization = await Organization.create({ name: "Suspended Tenant", slug: "suspended-tenant", createdBy: user._id, status: "suspended" });
  await Membership.create({ userId: user._id, organizationId: organization._id, role: "owner", status: "active" });
  const response = await fetch(\`\${baseUrl}/api/v1/auth/me\`, {
    headers: { authorization: \`Bearer \${accessToken(String(user._id), String(organization._id), "owner")}\` },
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json() as { message: string }).message, "Account or organization access is no longer active");
});

test("replayed rotated refresh tokens revoke every active token in their family", async () => {
  const user = await User.create({ name: "Replay User", email: "refresh-replay@example.test", passwordHash: "test-hash" });
  const organization = await Organization.create({ name: "Replay Tenant", slug: "refresh-replay-tenant", createdBy: user._id });
  await Membership.create({ userId: user._id, organizationId: organization._id, role: "owner", status: "active" });
  const oldToken = "old-refresh-token-replayed";
  const currentToken = "current-refresh-token-in-family";
  const familyId = "refresh-family-replay-test";
  await RefreshSession.create([
    { userId: user._id, familyId, tokenHash: hashToken(oldToken), expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date(), replacedByTokenHash: hashToken(currentToken) },
    { userId: user._id, familyId, tokenHash: hashToken(currentToken), expiresAt: new Date(Date.now() + 60_000), revokedAt: null },
  ]);
  const response = await fetch(\`\${baseUrl}/api/v1/auth/refresh\`, {
    method: "POST",
    headers: { cookie: \`buildsphere_refresh=\${oldToken}\` },
  });
  assert.equal(response.status, 401);
  assert.match((await response.json() as { message: string }).message, /reuse detected/i);
  const currentSession = await RefreshSession.findOne({ tokenHash: hashToken(currentToken) }).lean();
  assert.ok(currentSession?.revokedAt);
});

test("members can list active organizations and switch session context securely", async () => {
  const user = await User.create({ name: "Multi Tenant User", email: "multi-tenant@example.test", passwordHash: "test-hash" });
  const [firstOrganization, secondOrganization, suspendedOrganization] = await Organization.create([
    { name: "Primary Tenant", slug: "primary-tenant", createdBy: user._id },
    { name: "Secondary Tenant", slug: "secondary-tenant", createdBy: user._id },
    { name: "Suspended Secondary", slug: "suspended-secondary", createdBy: user._id, status: "suspended" },
  ]);
  await Membership.create([
    { userId: user._id, organizationId: firstOrganization._id, role: "owner", status: "active" },
    { userId: user._id, organizationId: secondOrganization._id, role: "admin", status: "active" },
    { userId: user._id, organizationId: suspendedOrganization._id, role: "owner", status: "active" },
  ]);
  const refreshToken = "multi-tenant-refresh-token";
  await RefreshSession.create({
    userId: user._id,
    familyId: "multi-tenant-refresh-family",
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + 60_000),
  });
  const currentAccessToken = accessToken(String(user._id), String(firstOrganization._id), "owner");
  const organizationsResponse = await fetch(\`\${baseUrl}/api/v1/auth/organizations\`, {
    headers: { authorization: \`Bearer \${currentAccessToken}\` },
  });
  assert.equal(organizationsResponse.status, 200);
  const organizations = await organizationsResponse.json() as { data: { id: string }[] };
  assert.deepEqual(organizations.data.map((item) => item.id).sort(), [String(firstOrganization._id), String(secondOrganization._id)].sort());

  const switchResponse = await fetch(\`\${baseUrl}/api/v1/auth/switch-organization\`, {
    method: "POST",
    headers: {
      authorization: \`Bearer \${currentAccessToken}\`,
      cookie: \`buildsphere_refresh=\${refreshToken}\`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ organizationId: String(secondOrganization._id) }),
  });
  assert.equal(switchResponse.status, 200);
  const switched = await switchResponse.json() as { data: { accessToken: string; organization: { id: string; role: string } } };
  assert.equal(switched.data.organization.id, String(secondOrganization._id));
  assert.equal(switched.data.organization.role, "admin");
  assert.ok(switchResponse.headers.get("set-cookie")?.includes("buildsphere_refresh="));

  const meResponse = await fetch(\`\${baseUrl}/api/v1/auth/me\`, {
    headers: { authorization: \`Bearer \${switched.data.accessToken}\` },
  });
  assert.equal(meResponse.status, 200);
  const me = await meResponse.json() as { data: { organization: { id: string; role: string } } };
  assert.equal(me.data.organization.id, String(secondOrganization._id));
  assert.equal(me.data.organization.role, "admin");

  const invalidSwitch = await fetch(\`\${baseUrl}/api/v1/auth/switch-organization\`, {
    method: "POST",
    headers: {
      authorization: \`Bearer \${switched.data.accessToken}\`,
      cookie: switchResponse.headers.get("set-cookie")!.split(";")[0]!,
      "content-type": "application/json",
    },
    body: JSON.stringify({ organizationId: String(suspendedOrganization._id) }),
  });
  assert.equal(invalidSwitch.status, 403);
});

test("readiness reports critical dependency health and fails closed when ClamAV is unavailable", async () => {
  const healthy = await fetch(\`\${baseUrl}/api/v1/ready\`);
  assert.equal(healthy.status, 200);
  const healthyBody = await healthy.json() as { dependencies: Record<string, string> };
  assert.equal(healthyBody.dependencies.mongodb, "connected");
  assert.equal(healthyBody.dependencies.collaborationOutboxTransactions, "enabled");
  assert.equal(healthyBody.dependencies.clamav, "available");
  assert.equal(healthyBody.dependencies.documentStorage, "writable");

  process.env.CLAMD_PORT = "1";
  const degraded = await fetch(\`\${baseUrl}/api/v1/ready\`);
  assert.equal(degraded.status, 503);
  const degradedBody = await degraded.json() as { dependencies: Record<string, string> };
  assert.equal(degradedBody.dependencies.clamav, "unavailable");
  process.env.CLAMD_PORT = String(scannerPort);
});
