import { Schema, model } from "mongoose";

const documentGovernanceEventSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, immutable: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, immutable: true, index: true },
  documentId: { type: Schema.Types.ObjectId, ref: "ProjectDocument", immutable: true },
  actorId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  action: { type: String, enum: ["retention_policy_updated", "legal_hold_placed", "legal_hold_released", "purge_request_created", "purge_request_approved", "purge_manifest_prepared"], required: true, immutable: true },
  reference: { type: String, maxlength: 100, default: "", immutable: true },
  details: { type: Schema.Types.Mixed, default: {}, immutable: true },
  occurredAt: { type: Date, default: Date.now, immutable: true },
}, { versionKey: false, timestamps: false });
documentGovernanceEventSchema.index({ organizationId: 1, projectId: 1, occurredAt: -1 });
export const DocumentGovernanceEvent = model("DocumentGovernanceEvent", documentGovernanceEventSchema);
