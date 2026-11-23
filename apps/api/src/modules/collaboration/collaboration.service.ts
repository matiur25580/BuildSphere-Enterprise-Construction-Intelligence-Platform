import mongoose, { type ClientSession } from "mongoose";
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

export const publishProjectEvent = async (input: ProjectEventInput, session?: ClientSession): Promise<void> => {
  if (!collaborationEventTypes.includes(input.eventType)) throw new Error("Unsupported collaboration event");
  await CollaborationOutbox.create([{
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
  }], session ? { session } : {});
};

let transactionSupport: "enabled" | "disabled" | "unverified" = "unverified";

export const configureCollaborationTransactions = async (): Promise<boolean> => {
  const mode = process.env.OUTBOX_TRANSACTION_MODE ?? "auto";
  if (!["auto", "required", "disabled"].includes(mode)) throw new Error("OUTBOX_TRANSACTION_MODE must be auto, required, or disabled");
  if (mode === "disabled") {
    transactionSupport = "disabled";
    console.warn("Collaboration outbox transactions are disabled by configuration; event enqueue is non-atomic.");
    return false;
  }
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  const supported = Boolean(hello?.setName || hello?.msg === "isdbgrid");
  transactionSupport = supported ? "enabled" : "disabled";
  if (!supported && mode === "required") throw new Error("OUTBOX_TRANSACTION_MODE=required but MongoDB is not a replica set or mongos; configure a transaction-capable MongoDB topology.");
  if (!supported) console.warn("MongoDB topology does not support transactions. Collaboration events use the documented non-atomic fallback. Set OUTBOX_TRANSACTION_MODE=required to fail startup instead.");
  return supported;
};

export const runProjectMutationWithEvent = async <T>(
  input: ProjectEventInput,
  mutation: (session?: ClientSession) => Promise<T>,
): Promise<T> => {
  if (transactionSupport === "unverified") throw new Error("Collaboration transaction topology has not been verified; configure it after connecting to MongoDB before accepting writes.");
  if (transactionSupport === "enabled") {
    const session = await mongoose.startSession();
    try {
      return await session.withTransaction(async () => {
        const result = await mutation(session);
        await publishProjectEvent(input, session);
        return result;
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } }) as T;
    } finally {
      await session.endSession();
    }
  }
  const result = await mutation();
  // Explicit non-transactional fallback: enqueue failure is surfaced, but the domain write may already be committed.
  await publishProjectEvent(input);
  return result;
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
      let activity = await Activity.findOne({ sourceEventId: event._id });
      if (!activity) {
        try {
          activity = await Activity.create({
            organizationId: event.organizationId, projectId: event.projectId,
            actorId: event.actorId, eventType: event.eventType, targetType: event.targetType,
            targetId: event.targetId, summary: event.summary, sourceEventId: event._id,
          });
        } catch (error) {
          if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
          activity = await Activity.findOne({ sourceEventId: event._id });
          if (!activity) throw error;
        }
      }
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
