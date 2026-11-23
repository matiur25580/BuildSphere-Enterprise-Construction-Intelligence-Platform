import { Schema, model } from "mongoose";

const documentAssetSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
  documentId: { type: Schema.Types.ObjectId, ref: "ProjectDocument", required: true, index: true },
  version: { type: Number, required: true, min: 1 },
  storageKey: { type: String, required: true, unique: true, immutable: true },
  fileName: { type: String, required: true, maxlength: 180, immutable: true },
  contentType: { type: String, enum: ["application/pdf", "image/png", "image/jpeg", "image/webp", "application/ifc"], required: true, immutable: true },
  byteSize: { type: Number, required: true, min: 1, max: 26214400, immutable: true },
  sha256: { type: String, required: true, match: /^[a-f0-9]{64}$/, immutable: true },
  scanStatus: { type: String, enum: ["clean", "infected"], required: true, default: "clean", immutable: true },
  uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
}, { timestamps: true });
documentAssetSchema.index({ organizationId: 1, projectId: 1, documentId: 1, version: 1 }, { unique: true });
export const DocumentAsset = model("DocumentAsset", documentAssetSchema);
