import { Schema, model } from "mongoose";

const manifestEntrySchema = new Schema({
  assetId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  documentId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  documentNo: { type: String, required: true, immutable: true },
  version: { type: Number, required: true, immutable: true },
  fileName: { type: String, required: true, immutable: true },
  storageKey: { type: String, required: true, immutable: true },
  sha256: { type: String, required: true, immutable: true },
  byteSize: { type: Number, required: true, immutable: true },
}, { _id: false });

const approvalSchema = new Schema({
  actorId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  comment: { type: String, required: true, trim: true, maxlength: 1000, immutable: true },
  approvedAt: { type: Date, required: true, immutable: true },
}, { _id: false });

const documentPurgeRequestSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, immutable: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, immutable: true, index: true },
  reference: { type: String, required: true, trim: true, maxlength: 100, immutable: true },
  reason: { type: String, required: true, trim: true, maxlength: 2000, immutable: true },
  requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  requestedAt: { type: Date, required: true, immutable: true },
  expiresAt: { type: Date, required: true, immutable: true, index: true },
  status: { type: String, enum: ["awaiting_approval", "approved", "prepared", "expired"], default: "awaiting_approval", required: true, index: true },
  candidates: { type: [manifestEntrySchema], required: true, immutable: true },
  approvals: { type: [approvalSchema], default: [] },
  manifest: {
    preparedAt: { type: Date },
    preparedBy: { type: Schema.Types.ObjectId, ref: "User" },
    entries: { type: [manifestEntrySchema], default: [] },
    manifestSha256: { type: String, default: "" },
  },
}, { timestamps: true, versionKey: false });

documentPurgeRequestSchema.index({ organizationId:  1, projectId: 1, requestedAt: -1 });
documentPurgeRequestSchema.index({ organizationId: 1, projectId: 1, status: 1 });
export const DocumentPurgeRequest = model("DocumentPurgeRequest", documentPurgeRequestSchema);
