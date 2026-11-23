import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { Activity, Notification, collaborationEventTypes } from "./collaboration.models.js";
import { CollaborationOutbox } from "./outbox.model.js";
import { ProjectMembership } from "../projects/project-membership.model.js";

export type ProjectEventInput = {
  organizationId: string;
  projectId: string;
  actorId: string;
  eventType: typeof collaborationEventTypes[number];
  targetType: string;
  targetId: string;
  summary: string;
  recipientIds?: string[];
};

export const notificationOwnerScope = (organizationId: string, recipientId: string) => ({
  organizationId: new mongoose.Types.ObjectId(organizationId),
  recipientId: new mongoose.Types.ObjectId(recipientId),
});

export const projectActivityScope = (organizationId: string, projectId: string) => ({
  organizationId: new mongoose.Types.ObjectId(organizationId),
  projectId: new mongoose.Types.ObjectId(projectId),
});

export const projectMemberScope = (organizationId: string, projectId: string, userId?: string) => ({
  organizationId: new mongoose.Types.ObjectId(organizationId),
  projectId: new mongoose.Types.ObjectId(projectId),
  ...(userId ? { userId: new mongoose.Types.ObjectId(userId) } : {}),
});

export const publishProjectEvent = async (input: ProjectEventInput): Promise<void> => {
  if (!collaborationEventTypes.includes(input.eventType)) throw new Error("Unsupported collaboration event");
  await CollaborationOutbox.create({
    organizationId: input.organizationId,
    projectId: input.projectId,
    actorId: input.actorId,
    eventType: input.eventType,
    targetType: input.targetType,
    targetId: input.targetId,
    summary: input.summary.trim().slice(0, 240),
    recipientIds: (input.recipientIds ?? []).map((id) => new mongoose.Types.ObjectId(id)),
    status: "pending",
    nextAttemptAt: new Date(),
  });
};

export const outboxLeaseFilter = (id: unknown, leaseToken: string) => ({ _id: id, status: "processing", leaseToken });

export const collaborationRetryDelay = (attempt: number): number => Math.min(60_000 * (2 ** Math.max(attempt - 1, 0)), 60 * 60 * 1000);
const MAX_ATTEMPTS = 8;
const LEASE_MS = 60_000;

export const processCollaborationOutboxBatch = async (batchSize = 25): Promise<number> => {
  let delivered = 0;
  for (let index = 0; index < Math.min(Math.max(batchSize, 1), 100); index += 1) {
    const now = new Date();
    const leaseToken = randomUUID();
    const event = await CollaborationOutbox.findOneAndUpdate({
      attempts: { $lt: MAX_ATTEMPTS },
      $or: [
        { status: "pending", nextAttemptAt: { $lte: now } },
        { status: "processing", leaseExpiresAt: { $lte: now } },
      ],
    }, {
      $set: { status: "processing", leaseExpiresAt: new Date(now.getTime() + LEASE_MS), leaseToken },
      $inc: { attempts: 1 },
    }, { new: true, sort: { createdAt: 1 } });
    if (!event) break;
    try {
      const activity = await Activity.findOneAndUpdate(
        { sourceEventId: event._id },
        { $setOnInsert: {
          organizationId: event.organizationId, projectId: event.projectId,
          actorId: event.actorId, eventType: event.eventType, targetType: event.targetType,
          targetId: event.targetId, summary: event.summary, sourceEventId: event._id,
        } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      const memberFilter: Record<string, unknown> = {
        organizationId: event.organizationId, projectId: event.projectId, status: "active",
        userId: { $ne: event.actorId },
      };
      if (event.recipientIds.length) memberFilter.userId = { $in: event.recipientIds };
      const members = await ProjectMembership.find(memberFilter).select("userId").lean();
      for (const member of members) {
        await Notification.updateOne(
          { activityId: activity._id, recipientId: member.userId },
          { $setOnInsert: {
            organizationId: event.organizationId, projectId: event.projectId,
            recipientId: member.userId, activityId: activity._id,
            eventType: event.eventType, summary: event.summary, readAt: null,
          } },
          { upsert: true, setDefaultsOnInsert: true },
        );
      }
      await CollaborationOutbox.updateOne(outboxLeaseFilter(event._id, leaseToken), {
        $set: { status: "delivered", deliveredAt: new Date(), leaseExpiresAt: null, leaseToken: null, lastError: "" },
      });
      delivered += 1;
    } catch (error) {
      const attempts = event.attempts;
      const failed = attempts >= MAX_ATTEMPTS;
      const delayMs = collaborationRetryDelay(attempts);
      await CollaborationOutbox.updateOne(outboxLeaseFilter(event._id, leaseToken), {
        $set: {
          status: failed ? "failed" : "pending",
          nextAttemptAt: new Date(Date.now() + delayMs),
          leaseExpiresAt: null,
          leaseToken: null,
          lastError: (error instanceof Error ? error.message : "Unknown outbox delivery error").slice(0, 500),
        },
      });
    }
  }
  return delivered;
};

export const publishProjectEventSafely = async (input: ProjectEventInput): Promise<void> => {
  try {
    await publishProjectEvent(input);
  } catch (error) {
    console.error("Collaboration outbox enqueue failed", error);
  }
};

export const startCollaborationOutboxWorker = (intervalMs = 2_000) => {
  let running = false;
  const tick = async () => {
    if (running || mongoose.connection.readyState !== 1) return;
    running = true;
    try { await processCollaborationOutboxBatch(25); }
    catch (error) { console.error("Collaboration outbox worker failed", error); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
};
