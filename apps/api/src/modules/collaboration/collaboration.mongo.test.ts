import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import type { Server } from "node:http";
import app from "../../app.js";
import { configureCollaborationTransactions, notificationOwnerScope, projectActivityScope, projectMemberScope, runProjectMutationWithEvent, processCollaborationOutboxBatch } from "./collaboration.service.js";
import { Activity, Notification } from "./collaboration.models.js";
import { ProjectMembership } from "../projects/project-membership.model.js";
import { CollaborationOutbox } from "./outbox.model.js";
import { User } from "../users/user.model.js";
import { Organization } from "../organizations/organization.model.js";
import { Membership } from "../organizations/membership.model.js";
import { Project } from "../projects/project.model.js";
import { WorkItem } from "../projects/work-item.model.js";


const mongoUri = process.env.MONGODB_URI;
let httpServer: Server | undefined;
let httpBaseUrl = "";
if (!mongoUri) throw new Error("MONGODB_URI is required for collaboration integration tests");

before(async () => {
  await mongoose.connect(mongoUri);
  const transactionsSupported = await configureCollaborationTransactions();
  assert.equal(transactionsSupported, true, "CI integration tests require replica-set transactions");
  await Promise.all([Activity.syncIndexes(), Notification.syncIndexes(), ProjectMembership.syncIndexes(), CollaborationOutbox.syncIndexes(), User.syncIndexes(), Organization.syncIndexes(), Membership.syncIndexes(), Project.syncIndexes(), WorkItem.syncIndexes()]);
});

after(async () => {
  if (httpServer) await new Promise<void>((resolve, reject) => httpServer!.close((error) => error ? reject(error) : resolve()));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("MongoDB tenant, project and recipient filters isolate collaboration records", async () => {
  const tenantA = new mongoose.Types.ObjectId();
  const tenantB = new mongoose.Types.ObjectId();
  const projectA = new mongoose.Types.ObjectId();
  const projectB = new mongoose.Types.ObjectId();
  const userA = new mongoose.Types.ObjectId();
  const userB = new mongoose.Types.ObjectId();
  const actor = new mongoose.Types.ObjectId();

  const [activityA, activityOtherTenant] = await Activity.create([
    { organizationId: tenantA, projectId: projectA, actorId: actor, eventType: "tasks.assigned", targetType: "work_item", targetId: new mongoose.Types.ObjectId(), summary: "Assignment for tenant A" },
    { organizationId: tenantB, projectId: projectA, actorId: actor, eventType: "tasks.assigned", targetType: "work_item", targetId: new mongoose.Types.ObjectId(), summary: "Other tenant event" },
  ]);
  const projectEvents = await Activity.find(projectActivityScope(String(tenantA), String(projectA))).lean();
  assert.deepEqual(projectEvents.map((item) => String(item._id)), [String(activityA._id)]);

  const [ownNotification, otherUserNotification, otherTenantNotification] = await Notification.create([
    { organizationId: tenantA, projectId: projectA, recipientId: userA, activityId: activityA._id, eventType: "tasks.assigned", summary: "My assignment" },
    { organizationId: tenantA, projectId: projectA, recipientId: userB, activityId: activityA._id, eventType: "tasks.assigned", summary: "Other user's assignment" },
    { organizationId: tenantB, projectId: projectA, recipientId: userA, activityId: activityOtherTenant._id, eventType: "tasks.assigned", summary: "Other tenant assignment" },
  ]);
  const ownInbox = await Notification.find(notificationOwnerScope(String(tenantA), String(userA))).lean();
  assert.deepEqual(ownInbox.map((item) => String(item._id)), [String(ownNotification._id)]);

  await Notification.updateMany({
    ...notificationOwnerScope(String(tenantA), String(userA)),
    _id: { $in: [ownNotification._id, otherUserNotification._id, otherTenantNotification._id] },
  }, { $set: { readAt: new Date() } });
  const refreshed = await Notification.find({ _id: { $in: [ownNotification._id, otherUserNotification._id, otherTenantNotification._id] } }).lean();
  const readById = new Map(refreshed.map((item) => [String(item._id), item.readAt]));
  assert.ok(readById.get(String(ownNotification._id)));
  assert.equal(readById.get(String(otherUserNotification._id)), null);
  assert.equal(readById.get(String(otherTenantNotification._id)), null);

  await ProjectMembership.create([
    { organizationId: tenantA, projectId: projectA, userId: userA, role: "contributor", status: "active", addedBy: actor },
    { organizationId: tenantA, projectId: projectB, userId: userA, role: "viewer", status: "active", addedBy: actor },
    { organizationId: tenantB, projectId: projectA, userId: userA, role: "viewer", status: "active", addedBy: actor },
  ]);
  const projectMembers = await ProjectMembership.find(projectMemberScope(String(tenantA), String(projectA))).lean();
  assert.equal(projectMembers.length, 1);
  assert.equal(String(projectMembers[0].userId), String(userA));
});

test("MongoDB rejects stale outbox worker completion after lease takeover", async () => {
  const organizationId = new mongoose.Types.ObjectId();
  const projectId = new mongoose.Types.ObjectId();
  const actorId = new mongoose.Types.ObjectId();
  const targetId = new mongoose.Types.ObjectId();
  const event = await CollaborationOutbox.create({
    organizationId, projectId, actorId, eventType: "safety.event_status_changed",
    targetType: "safety_event", targetId, summary: "Safety event status changed",
    status: "processing", attempts: 2, leaseToken: "current-worker-token",
    leaseExpiresAt: new Date(Date.now() + 30_000),
  });
  const stale = await CollaborationOutbox.updateOne(
    { _id: event._id, status: "processing", leaseToken: "expired-worker-token" },
    { $set: { status: "delivered", deliveredAt: new Date() } },
  );
  assert.equal(stale.modifiedCount, 0);
  const current = await CollaborationOutbox.findById(event._id).lean();
  assert.equal(current?.status, "processing");
  assert.equal(current?.leaseToken, "current-worker-token");
});


test("transactional domain writes roll back and commit with their outbox event", async () => {
  const organizationId = new mongoose.Types.ObjectId();
  const actorId = new mongoose.Types.ObjectId();
  const failedProject = new Project({
    organizationId, code: "ROLLBACK", name: "Rollback project",
    startDate: new Date("2026-01-01"), targetEndDate: new Date("2026-12-31"), createdBy: actorId,
  });
  const event = {
    organizationId: String(organizationId), projectId: String(failedProject._id), actorId: String(actorId),
    eventType: "tasks.assigned" as const, targetType: "project", targetId: String(failedProject._id), summary: "transaction rollback test",
  };
  await assert.rejects(runProjectMutationWithEvent({ ...event, eventType: "invalid.event" as never }, (session) => failedProject.save(session ? { session } : {})), /Unsupported collaboration event/);
  assert.equal(await Project.countDocuments({ _id: failedProject._id }), 0);
  assert.equal(await CollaborationOutbox.countDocuments({ targetId: failedProject._id }), 0);

  const committedProject = new Project({
    organizationId, code: "COMMIT", name: "Committed project",
    startDate: new Date("2026-01-01"), targetEndDate: new Date("2026-12-31"), createdBy: actorId,
  });
  const committedEvent = { ...event, projectId: String(committedProject._id), targetId: String(committedProject._id) };
  await runProjectMutationWithEvent(committedEvent, (session) => committedProject.save(session ? { session } : {}));
  assert.ok(await Project.exists({ _id: committedProject._id }));
  assert.equal(await CollaborationOutbox.countDocuments({ targetId: committedProject._id, status: "pending" }), 1);
  await CollaborationOutbox.updateOne({ targetId: committedProject._id }, { $set: { status: "delivered" } });
});

test("outbox worker recovers expired leases and retries idempotently after partial delivery", async () => {
  const organizationId = new mongoose.Types.ObjectId();
  const projectId = new mongoose.Types.ObjectId();
  const actorId = new mongoose.Types.ObjectId();
  const recipientId = new mongoose.Types.ObjectId();
  const targetId = new mongoose.Types.ObjectId();
  await ProjectMembership.create([
    { organizationId, projectId, userId: recipientId, role: "contributor", status: "active", addedBy: actorId },
    { organizationId, projectId, userId: actorId, role: "project_manager", status: "active", addedBy: actorId },
  ]);
  const event = await CollaborationOutbox.create({
    organizationId, projectId, actorId, eventType: "tasks.assigned",
    targetType: "work_item", targetId, summary: "Assigned work item",
    status: "processing", attempts: 1, leaseToken: "crashed-worker",
    leaseExpiresAt: new Date(Date.now() - 1),
    recipientIds: [recipientId, actorId],
  });
  await Activity.create({ organizationId, projectId, actorId, eventType: "tasks.assigned", targetType: "work_item", targetId, summary: "Assigned work item", sourceEventId: event._id });
  assert.equal(await processCollaborationOutboxBatch(1), 1);
  assert.equal(await Activity.countDocuments({ sourceEventId: event._id }), 1);
  assert.equal(await Notification.countDocuments({ activityId: { $in: await Activity.find({ sourceEventId: event._id }).distinct("_id") }, recipientId }), 1);
  assert.equal(await Notification.countDocuments({ activityId: { $in: await Activity.find({ sourceEventId: event._id }).distinct("_id") }, recipientId: actorId }), 0);
  await CollaborationOutbox.updateOne({ _id: event._id }, { $set: { status: "pending", nextAttemptAt: new Date(0), leaseToken: null, leaseExpiresAt: null } });
  assert.equal(await processCollaborationOutboxBatch(1), 1);
  assert.equal(await Activity.countDocuments({ sourceEventId: event._id }), 1);
  assert.equal(await Notification.countDocuments({ recipientId, summary: "Assigned work item" }), 1);
});

test("HTTP/JWT routes enforce notification ownership, project membership, role and tenant boundaries", async () => {
  const secret = process.env.JWT_ACCESS_SECRET;
  assert.ok(secret && secret.length >= 32);
  const userA = await User.create({ name: "Tenant A owner", email: "owner-a@example.test", passwordHash: "test-hash" });
  const viewer = await User.create({ name: "Project viewer", email: "viewer@example.test", passwordHash: "test-hash" });
  const nonMember = await User.create({ name: "Non member", email: "outsider@example.test", passwordHash: "test-hash" });
  const assignee = await User.create({ name: "Assignee", email: "assignee@example.test", passwordHash: "test-hash" });
  const invitee = await User.create({ name: "Invitee", email: "invitee@example.test", passwordHash: "test-hash" });
  const inactiveMember = await User.create({ name: "Inactive member", email: "inactive@example.test", passwordHash: "test-hash" });
  const userB = await User.create({ name: "Tenant B user", email: "user-b@example.test", passwordHash: "test-hash" });
  const admin = await User.create({ name: "Tenant A admin", email: "admin-a@example.test", passwordHash: "test-hash" });
  const secondOwner = await User.create({ name: "Second owner", email: "owner-two@example.test", passwordHash: "test-hash" });
  const newMember = await User.create({ name: "New member", email: "new-member@example.test", passwordHash: "test-hash" });
  const adminTarget = await User.create({ name: "Admin target", email: "admin-target@example.test", passwordHash: "test-hash" });
  const projectManager = await User.create({ name: "Project manager", email: "project-manager@example.test", passwordHash: "test-hash" });
  const orgA = await Organization.create({ name: "Tenant A", slug: "tenant-a-test", createdBy: userA._id });
  const orgB = await Organization.create({ name: "Tenant B", slug: "tenant-b-test", createdBy: userB._id });
  await Membership.create([
    { userId: userA._id, organizationId: orgA._id, role: "owner", status: "active" },
    { userId: viewer._id, organizationId: orgA._id, role: "member", status: "active" },
    { userId: nonMember._id, organizationId: orgA._id, role: "member", status: "active" },
    { userId: assignee._id, organizationId: orgA._id, role: "member", status: "active" },
    { userId: invitee._id, organizationId: orgA._id, role: "member", status: "active" },
    { userId: inactiveMember._id, organizationId: orgA._id, role: "member", status: "active" },
    { userId: userB._id, organizationId: orgB._id, role: "owner", status: "active" },
    { userId: admin._id, organizationId: orgA._id, role: "admin", status: "active" },
    { userId: secondOwner._id, organizationId: orgA._id, role: "owner", status: "active" },
    { userId: adminTarget._id, organizationId: orgA._id, role: "member", status: "active" },
    { userId: projectManager._id, organizationId: orgA._id, role: "member", status: "active" },
  ]);
  const project = await Project.create({
    organizationId: orgA._id, code: "HTTP-1", name: "HTTP authorization project",
    startDate: new Date("2026-01-01"), targetEndDate: new Date("2027-01-01"), createdBy: userA._id,
  });
  await ProjectMembership.create([
    { organizationId: orgA._id, projectId: project._id, userId: viewer._id, role: "contributor", status: "active", addedBy: userA._id },
    { organizationId: orgA._id, projectId: project._id, userId: assignee._id, role: "contributor", status: "active", addedBy: userA._id },
    { organizationId: orgA._id, projectId: project._id, userId: inactiveMember._id, role: "contributor", status: "inactive", addedBy: userA._id },
    { organizationId: orgA._id, projectId: project._id, userId: projectManager._id, role: "project_manager", status: "active", addedBy: userA._id },
  ]);
  const otherProjectMembership = await ProjectMembership.create({
    organizationId: orgA._id, projectId: new mongoose.Types.ObjectId(), userId: invitee._id,
    role: "viewer", status: "active", addedBy: userA._id,
  });
  const otherTenantMembership = await ProjectMembership.create({
    organizationId: orgB._id, projectId: new mongoose.Types.ObjectId(), userId: userB._id,
    role: "viewer", status: "active", addedBy: userB._id,
  });
  const activity = await Activity.create({
    organizationId: orgA._id, projectId: project._id, actorId: userA._id,
    eventType: "tasks.assigned", targetType: "work_item", targetId: new mongoose.Types.ObjectId(), summary: "Visible project activity",
  });
  const otherTenantActivity = await Activity.create({
    organizationId: orgB._id, projectId: project._id, actorId: userB._id,
    eventType: "tasks.assigned", targetType: "work_item", targetId: new mongoose.Types.ObjectId(), summary: "Other tenant activity",
  });
  const ownNotification = await Notification.create({ organizationId: orgA._id, projectId: project._id, recipientId: userA._id, activityId: activity._id, eventType: "tasks.assigned", summary: "Owner notification" });
  const viewerNotification = await Notification.create({ organizationId: orgA._id, projectId: project._id, recipientId: viewer._id, activityId: activity._id, eventType: "tasks.assigned", summary: "Viewer notification" });
  await Notification.create({ organizationId: orgB._id, projectId: project._id, recipientId: userA._id, activityId: otherTenantActivity._id, eventType: "tasks.assigned", summary: "Cross-tenant notification" });

  const token = (userId: string, organizationId: string, role: string) => jwt.sign({ organizationId, role }, secret, { subject: userId, expiresIn: "5m" });
  const ownerToken = token(String(userA._id), String(orgA._id), "owner");
  const viewerToken = token(String(viewer._id), String(orgA._id), "member");
  const outsiderToken = token(String(nonMember._id), String(orgA._id), "member");
  const inactiveToken = token(String(inactiveMember._id), String(orgA._id), "member");
  const tenantBToken = token(String(userB._id), String(orgB._id), "owner");
  const adminToken = token(String(admin._id), String(orgA._id), "admin");
  const projectManagerToken = token(String(projectManager._id), String(orgA._id), "member");
  const secondOwnerToken = token(String(secondOwner._id), String(orgA._id), "owner");
  httpServer = app.listen(0);
  await new Promise<void>((resolve) => httpServer!.once("listening", resolve));
  const address = httpServer.address();
  assert.ok(address && typeof address !== "string");
  httpBaseUrl = `http://127.0.0.1:${address.port}`;
  const call = (path: string, bearer?: string, method = "GET", body?: unknown) => fetch(`${httpBaseUrl}${path}`, {
    method, headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  assert.equal((await call("/api/v1/notifications")).status, 401);

  assert.equal((await call("/api/v1/organization/members")).status, 401);
  assert.equal((await call("/api/v1/organization/members", viewerToken)).status, 403);
  const organizationMembers = await call("/api/v1/organization/members", ownerToken);
  assert.equal(organizationMembers.status, 200);
  const organizationMembersBody = await organizationMembers.json() as { data: Array<{ organizationId: string }> };
  assert.ok(organizationMembersBody.data.length >= 8);
  const addedOrganizationMember = await call("/api/v1/organization/members", ownerToken, "POST", { email: newMember.email, role: "member" });
  assert.equal(addedOrganizationMember.status, 201);
  const addedOrganizationMemberBody = await addedOrganizationMember.json() as { data: { _id: string } };
  assert.equal((await call("/api/v1/organization/members", ownerToken, "POST", { email: newMember.email, role: "member" })).status, 409);
  assert.equal((await call("/api/v1/organization/members", adminToken, "POST", { email: adminTarget.email, role: "admin" })).status, 403);
  const adminRoleChange = await call(`/api/v1/organization/members/${String((await Membership.findOne({ organizationId: orgA._id, userId: admin._id }))?._id)}`, adminToken, "PATCH", { role: "member" });
  assert.equal(adminRoleChange.status, 403);
  const crossTenantMember = await Membership.findOne({ organizationId: orgA._id, userId: viewer._id });
  assert.ok(crossTenantMember);
  assert.equal((await call(`/api/v1/organization/members/${crossTenantMember.id}`, tenantBToken, "PATCH", { status: "suspended" })).status, 404);
  assert.equal((await call(`/api/v1/organization/members/${addedOrganizationMemberBody.data._id}`, ownerToken, "PATCH", { status: "suspended" })).status, 200);
  assert.equal((await call("/api/v1/notifications", token(String(newMember._id), String(orgA._id), "member"))).status, 401);
  const secondOwnerMembership = await Membership.findOne({ organizationId: orgA._id, userId: secondOwner._id });
  assert.ok(secondOwnerMembership);
  assert.equal((await call(`/api/v1/organization/members/${secondOwnerMembership.id}`, ownerToken, "PATCH", { status: "suspended" })).status, 200);
  const soleOwnerMembership = await Membership.findOne({ organizationId: orgA._id, userId: userA._id });
  assert.ok(soleOwnerMembership);
  assert.equal((await call(`/api/v1/organization/members/${soleOwnerMembership.id}`, ownerToken, "PATCH", { status: "suspended" })).status, 409);
  assert.equal((await call("/api/v1/organization/members", secondOwnerToken)).status, 401);
  const inbox = await call("/api/v1/notifications", ownerToken);
  assert.equal(inbox.status, 200);
  const inboxBody = await inbox.json() as { data: { items: Array<{ _id: string }> } };
  assert.deepEqual(inboxBody.data.items.map((item) => item._id), [String(ownNotification._id)]);
  const marked = await call("/api/v1/notifications/read", ownerToken, "PATCH", { notificationIds: [String(ownNotification._id), String(viewerNotification._id)] });
  assert.equal(marked.status, 200);
  const modified = await marked.json() as { data: { modified: number } };
  assert.equal(modified.data.modified, 1);
  assert.ok((await Notification.findById(ownNotification._id))?.readAt);
  assert.equal((await Notification.findById(viewerNotification._id))?.readAt, null);

  assert.equal((await call(`/api/v1/projects/${project.id}/collaboration/activity`, viewerToken)).status, 200);
  assert.equal((await call(`/api/v1/projects/${project.id}/collaboration/activity`, outsiderToken)).status, 403);
  assert.equal((await call(`/api/v1/projects/${project.id}/collaboration/activity`, inactiveToken)).status, 403);
  assert.equal((await call(`/api/v1/projects/${project.id}/collaboration/activity`, tenantBToken)).status, 404);
  assert.equal((await call(`/api/v1/projects/${project.id}`, viewerToken)).status, 200);
  assert.equal((await call(`/api/v1/projects/${project.id}`, outsiderToken)).status, 403);
  assert.equal((await call(`/api/v1/projects/${project.id}`, inactiveToken)).status, 403);
  assert.equal((await call(`/api/v1/projects/${project.id}`, tenantBToken)).status, 404);
  assert.equal((await call(`/api/v1/projects/${project.id}`, viewerToken, "PATCH", { name: "Unauthorized rename" })).status, 403);
  assert.equal((await call(`/api/v1/projects/${project.id}`, projectManagerToken, "PATCH", { name: "Manager-approved rename" })).status, 200);
  assert.equal((await call(`/api/v1/projects/${project.id}/work-items`, projectManagerToken, "POST", {
    code: "TASK-MANAGER", title: "Project manager can create schedule items", startDate: "2026-02-01", endDate: "2026-02-02",
  })).status, 201);
  assert.equal((await call(`/api/v1/projects/${project.id}/work-items`, viewerToken, "POST", {
    code: "TASK-DENIED", title: "Contributor cannot create schedule items", startDate: "2026-02-01", endDate: "2026-02-02",
  })).status, 403);
  assert.equal((await call(`/api/v1/projects/${project.id}/commercial/records`, outsiderToken)).status, 403);
  assert.equal((await call(`/api/v1/projects/${project.id}/bim/models`, ownerToken)).status, 200);
  assert.equal((await call(`/api/v1/projects/${project.id}/members`, outsiderToken)).status, 403);
  assert.equal((await call(`/api/v1/projects/${project.id}/members/eligible`, viewerToken)).status, 403);
  assert.equal((await call(`/api/v1/projects/${project.id}/members/eligible`, outsiderToken)).status, 403);
  assert.equal((await call(`/api/v1/projects/${project.id}/members`, viewerToken, "POST", { userId: String(assignee._id), role: "viewer" })).status, 403);
  assert.equal((await call(`/api/v1/projects/${project.id}/members`, ownerToken, "POST", { userId: String(userB._id), role: "viewer" })).status, 404);
  assert.equal((await call(`/api/v1/projects/${project.id}/members`, ownerToken, "POST", { userId: String(invitee._id), role: "viewer" })).status, 201);
  assert.equal((await call(`/api/v1/projects/${project.id}/members/eligible`, projectManagerToken)).status, 200);
  assert.equal((await call(`/api/v1/projects/${project.id}/members/${otherProjectMembership.id}`, ownerToken, "PATCH", { role: "contributor" })).status, 404);
  assert.equal((await call(`/api/v1/projects/${project.id}/members/${otherTenantMembership.id}`, ownerToken, "PATCH", { status: "inactive" })).status, 404);

  const task = await call(`/api/v1/projects/${project.id}/work-items`, ownerToken, "POST", {
    code: "TASK-HTTP", title: "Assigned task", startDate: "2026-02-01", endDate: "2026-02-02", assignedUserId: String(assignee._id),
  });
  assert.equal(task.status, 201);
  const taskBody = await task.json() as { data: { _id: string } };
  const assignmentEvent = await CollaborationOutbox.findOne({ targetId: taskBody.data._id, eventType: "tasks.assigned" });
  assert.ok(assignmentEvent);
  assert.equal(String(assignmentEvent.actorId), String(userA._id));
  assert.deepEqual(assignmentEvent.recipientIds.map(String), [String(assignee._id)]);

  const crossTenantAssignment = await call(`/api/v1/projects/${project.id}/work-items`, ownerToken, "POST", {
    code: "TASK-CROSS-TENANT", title: "Invalid cross-tenant assignment", startDate: "2026-02-01", endDate: "2026-02-02", assignedUserId: String(userB._id),
  });
  assert.equal(crossTenantAssignment.status, 400);

  const safety = await call(`/api/v1/projects/${project.id}/delivery/safety-events`, ownerToken, "POST", {
    reference: "SAFE-HTTP", type: "hazard", title: "Unsafe access", description: "An unsafe access route was identified.", occurredAt: "2026-11-20T10:00:00.000Z",
  });
  assert.equal(safety.status, 201);
  const safetyBody = await safety.json() as { data: { _id: string } };
  assert.ok(await CollaborationOutbox.exists({ targetId: safetyBody.data._id, eventType: "safety.event_created", actorId: userA._id, organizationId: orgA._id }));

  assert.equal((await call(`/api/v1/projects/${project.id}/commercial/records`, viewerToken, "POST", {
    type: "purchase_order", reference: "PO-DENIED", counterparty: "Supplier", amount: 1200, issueDate: "2026-11-20T00:00:00.000Z",
  })).status, 403);
  const commercial = await call(`/api/v1/projects/${project.id}/commercial/records`, ownerToken, "POST", {
    type: "purchase_order", reference: "PO-HTTP", counterparty: "Supplier", amount: 1200, issueDate: "2026-11-20T00:00:00.000Z",
  });
  assert.equal(commercial.status, 201);
  const commercialBody = await commercial.json() as { data: { _id: string } };
  assert.ok(await CollaborationOutbox.exists({ targetId: commercialBody.data._id, eventType: "commercial.record_created", actorId: userA._id, organizationId: orgA._id }));

  const failedEvent = await CollaborationOutbox.create({
    organizationId: orgA._id, projectId: project._id, actorId: userA._id, eventType: "tasks.assigned",
    targetType: "work_item", targetId: new mongoose.Types.ObjectId(), summary: "Failed event for replay",
    status: "failed", attempts: 8, nextAttemptAt: new Date(),
  });
  assert.equal((await call(`/api/v1/projects/${project.id}/collaboration/outbox/failed`, viewerToken)).status, 403);
  const replay = await call(`/api/v1/projects/${project.id}/collaboration/outbox/${failedEvent.id}/replay`, ownerToken, "POST");
  assert.equal(replay.status, 200);
  const replayed = await CollaborationOutbox.findById(failedEvent._id);
  assert.equal(replayed?.status, "pending");
  assert.equal(replayed?.replayCount, 1);
});

test("activity audit records reject application-level mutation and deletion", async () => {
  const record = await Activity.create({
    organizationId: new mongoose.Types.ObjectId(), projectId: new mongoose.Types.ObjectId(),
    actorId: new mongoose.Types.ObjectId(), eventType: "tasks.assigned",
    targetType: "work_item", targetId: new mongoose.Types.ObjectId(), summary: "Immutable audit record",
  });
  await assert.rejects(Activity.updateOne({ _id: record._id }, { $set: { summary: "tampered" } }), /append-only/);
  await assert.rejects(Activity.deleteOne({ _id: record._id }), /append-only/);
  assert.equal((await Activity.findById(record._id))?.summary, "Immutable audit record");
});
