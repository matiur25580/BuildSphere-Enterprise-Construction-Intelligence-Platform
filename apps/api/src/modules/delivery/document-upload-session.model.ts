import { Schema, model } from "mongoose";

const uploadPartSchema = new Schema({
  partNumber: { type: Number, required: true, min: 1, max: 5 },
  storageKey: { type: String, required: true },
  byteSize: { type: Number, required: true, min: 1, max: 5242880 },
  sha256: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
}, { _id: false });

const documentUploadSessionSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
  documentId: { type: Schema.Types.ObjectId, ref: "ProjectDocument", required: true, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  fileName: { type: String, required: true, maxlength: 180 },
  contentType: { type: String, enum: ["application/pdf", "image/png", "image/jpeg", "image/webp", "application/ifc"], required: true },
  totalBytes: { type: Number, required: true, min: 1, max: 26214400 },
  expectedSha256: { type: String, match: /^[a-f0-9]{64}$/ },
  expectedParts: { type: Number, required: true, min: 1, max: 5 },
  parts: { type: [uploadPartSchema], default: [] },
  status: { type: String, enum: ["uploading", "completing", "completed", "aborted"], default: "uploading", index: true },
  expiresAt: { type: Date, required: true, index: true },
}, { timestamps: true });
documentUploadSessionSchema.index({ organizationId: 1, projectId: 1, documentId: 1, createdBy: 1, status: 1 });
export const DocumentUploadSession = model("DocumentUploadSession", documentUploadSessionSchema);
