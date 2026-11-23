import { Schema, model } from "mongoose";

const documentLegalHoldSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, immutable: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, immutable: true, index: true },
  documentId: { type: Schema.Types.ObjectId, ref: "ProjectDocument", required: true, immutable: true, index: true },
  reference: { type: String, required: true, trim: true, maxlength: 100, immutable: true },
  reason: { type: String, required: true, trim: true, maxlength: 2000, immutable: true },
  status: { type: String, enum: ["active", "released"], default: "active", required: true, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  releasedBy: { type: Schema.Types.ObjectId, ref: "User" },
  releasedAt: { type: Date },
  releaseComment: { type: String, trim: true, maxlength: 2000, default: "" },
}, { timestamps: true, versionKey: false });
documentLegalHoldSchema.index({ organizationId: 1, projectId: 1, documentId: 1, status: 1 });
export const DocumentLegalHold = model("DocumentLegalHold", documentLegalHoldSchema);
