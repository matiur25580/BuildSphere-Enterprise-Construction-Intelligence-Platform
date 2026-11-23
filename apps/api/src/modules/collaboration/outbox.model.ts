import { Schema, model } from "mongoose";
import { collaborationEventTypes } from "./collaboration.models.js";

const outboxSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true },
  projectId: { type: Schema.Types.ObjectId, required: true },
  actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  eventType: { type: String, enum: collaborationEventTypes, required: true },
  targetType: { type: String, required: true, maxlength: 40 },
  targetId: { type: Schema.Types.ObjectId, required: true },
  summary: { type: String, required: true, maxlength: 240 },
  recipientIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
  status: { type: String, enum: ["pending", "processing", "delivered", "failed"], default: "pending", required: true },
  attempts: { type: Number, min: 0, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now, required: true },
  leaseExpiresAt: { type: Date, default: null },
  lastError: { type: String, maxlength: 500, default: "" },
  deliveredAt: { type: Date, default: null },
}, { timestamps: true });

outboxSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
outboxSchema.index({ status: 1, leaseExpiresAt: 1 });
export const CollaborationOutbox = model("CollaborationOutbox", outboxSchema);
