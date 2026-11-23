import { Schema, model } from "mongoose";

const eventTypes = [
  "commercial.record_created", "commercial.status_changed", "tasks.assigned",
  "quality.inspection_created", "quality.inspection_status_changed", "quality.ncr_created", "quality.ncr_status_changed",
  "quality.capa_created", "quality.capa_status_changed", "safety.event_created", "safety.event_status_changed",
  "coordination.rfi_created", "coordination.rfi_submitted", "coordination.rfi_responded",
  "coordination.submittal_created", "coordination.submittal_submitted", "coordination.submittal_reviewed",
  "documents.created", "documents.version_added", "documents.approval_changed",
  "bim.model_registered", "bim.issue_created", "bim.issue_status_changed",
] as const;

const activitySchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, required: true, index: true },
  actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  eventType: { type: String, enum: eventTypes, required: true },
  targetType: { type: String, required: true, maxlength: 40 },
  targetId: { type: Schema.Types.ObjectId, required: true },
  summary: { type: String, required: true, maxlength: 240 },
  sourceEventId: { type: Schema.Types.ObjectId },
}, { timestamps: { createdAt: true, updatedAt: false } });
activitySchema.index({ organizationId: 1, projectId: 1, createdAt: -1, _id: -1 });
activitySchema.pre("save", function () { if (!this.isNew) throw new Error("Activity records are append-only"); });
for (const operation of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"] as const) {
  activitySchema.pre(operation, function () { throw new Error("Activity records are append-only"); });
}
activitySchema.index({ sourceEventId: 1 }, { unique: true, sparse: true });

const notificationSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, required: true, index: true },
  recipientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  activityId: { type: Schema.Types.ObjectId, ref: "Activity", required: true },
  eventType: { type: String, enum: eventTypes, required: true },
  summary: { type: String, required: true, maxlength: 240 },
  readAt: { type: Date, default: null },
}, { timestamps: true });
notificationSchema.index({ organizationId: 1, recipientId: 1, createdAt: -1, _id: -1 });
notificationSchema.index({ organizationId: 1, recipientId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ activityId: 1, recipientId: 1 }, { unique: true });

export const Activity = model("Activity", activitySchema);
export const Notification = model("Notification", notificationSchema);
export const collaborationEventTypes = eventTypes;
