import { Schema, model } from "mongoose";

const documentAuditEventSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, immutable: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, immutable: true, index: true },
  documentId: { type: Schema.Types.ObjectId, ref: "ProjectDocument", required: true, immutable: true, index: true },
  assetId: { type: Schema.Types.ObjectId, ref: "DocumentAsset", required: true, immutable: true },
  actorId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  action: { type: String, enum: ["uploaded", "download_authorized"], required: true, immutable: true },
  fileName: { type: String, required: true, maxlength: 180, immutable: true },
  sha256: { type: String, required: true, match: /^[a-f0-9]{64}$/, immutable: true },
  requestId: { type: String, maxlength: 80, default: "", immutable: true },
  occurredAt: { type: Date, default: Date.now, immutable: true },
}, { versionKey: false, timestamps: false });
documentAuditEventSchema.index({ organizationId: 1, projectId: 1, documentId: 1, occurredAt: -1 });
export const DocumentAuditEvent = model("DocumentAuditEvent", documentAuditEventSchema);
