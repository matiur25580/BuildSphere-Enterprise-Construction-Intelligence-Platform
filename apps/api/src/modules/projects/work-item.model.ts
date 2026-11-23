import { Schema, model } from "mongoose";

const workItemSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
  parentId: { type: Schema.Types.ObjectId, ref: "WorkItem", default: null },
  code: { type: String, required: true, trim: true, maxlength: 32 },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  description: { type: String, trim: true, maxlength: 2000, default: "" },
  type: { type: String, enum: ["summary", "task", "milestone"], default: "task" },
  status: { type: String, enum: ["not_started", "in_progress", "blocked", "completed"], default: "not_started" },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  progress: { type: Number, min: 0, max: 100, default: 0 },
  assignedTo: { type: String, trim: true, maxlength: 120, default: "" },
  assignedUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  predecessorIds: [{ type: Schema.Types.ObjectId, ref: "WorkItem" }],
}, { timestamps: true });

workItemSchema.index({ organizationId: 1, projectId: 1, code: 1 }, { unique: true });
workItemSchema.index({ organizationId: 1, projectId: 1, startDate: 1 });

export const WorkItem = model("WorkItem", workItemSchema);
