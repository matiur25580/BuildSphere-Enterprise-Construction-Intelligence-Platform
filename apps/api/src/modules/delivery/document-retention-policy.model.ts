import { Schema, model } from "mongoose";

const documentRetentionPolicySchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, immutable: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, immutable: true, index: true },
  enabled: { type: Boolean, default: false, required: true },
  retentionDays: { type: Number, min: 365, max: 36500, default: 2555, required: true },
  minimumVersions: { type: Number, min: 1, max: 100, default: 1, required: true },
  reviewBeforePurgeDays: { type: Number, min: 1, max: 365, default: 30, required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true, versionKey: false });
documentRetentionPolicySchema.index({ organizationId: 1, projectId: 1 }, { unique: true });
export const DocumentRetentionPolicy = model("DocumentRetentionPolicy", documentRetentionPolicySchema);
