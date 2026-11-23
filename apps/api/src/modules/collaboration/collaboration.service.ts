import mongoose from "mongoose";
import { Membership } from "../organizations/membership.model.js";
import { Activity, Notification, collaborationEventTypes } from "./collaboration.models.js";

type EventInput = {
  organizationId: string;
  projectId: string;
  actorId: string;
  eventType: typeof collaborationEventTypes[number];
  targetType: string;
  targetId: string;
  summary: string;
};

export const publishProjectEvent = async (input: EventInput): Promise<void> => {
  if (!collaborationEventTypes.includes(input.eventType)) throw new Error("Unsupported collaboration event");
  const activity = await Activity.create({
    organizationId: input.organizationId,
    projectId: input.projectId,
    actorId: input.actorId,
    eventType: input.eventType,
    targetType: input.targetType,
    targetId: input.targetId,
    summary: input.summary.slice(0, 240),
  });
  const memberships = await Membership.find({
    organizationId: input.organizationId,
    status: "active",
    userId: { $ne: input.actorId },
  }).select("userId").lean();
  if (memberships.length) {
    await Notification.insertMany(memberships.map(({ userId }) => ({
      organizationId: input.organizationId,
      projectId: input.projectId,
      recipientId: userId,
      activityId: activity._id,
      eventType: input.eventType,
      summary: input.summary.slice(0, 240),
    })), { ordered: false });
  }
};

export const notificationOwnerScope = (organizationId: string, recipientId: string) => ({
  organizationId: new mongoose.Types.ObjectId(organizationId),
  recipientId: new mongoose.Types.ObjectId(recipientId),
});

export const projectActivityScope = (organizationId: string, projectId: string) => ({
  organizationId: new mongoose.Types.ObjectId(organizationId),
  projectId: new mongoose.Types.ObjectId(projectId),
});
