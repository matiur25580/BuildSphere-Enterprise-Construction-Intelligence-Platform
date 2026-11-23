import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { Activity, Notification } from "./collaboration.models.js";
import { ProjectMembership } from "../projects/project-membership.model.js";
import { notificationOwnerScope, projectActivityScope, projectMemberScope } from "./collaboration.service.js";

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) throw new Error("MONGODB_URI is required for collaboration integration tests");

before(async () => {
  await mongoose.connect(mongoUri);
  await Promise.all([Activity.syncIndexes(), Notification.syncIndexes(), ProjectMembership.syncIndexes()]);
});

after(async () => {
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
