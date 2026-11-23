import { Schema, model } from "mongoose";

const bimModelSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
  documentId: { type: Schema.Types.ObjectId, ref: "ProjectDocument", required: true, index: true },
  assetId: { type: Schema.Types.ObjectId, ref: "DocumentAsset", required: true, immutable: true },
  modelName: { type: String, required: true, trim: true, maxlength: 160 },
  discipline: { type: String, enum: ["architecture", "structure", "mechanical", "electrical", "plumbing", "civil", "landscape", "federated", "other"], required: true },
  revision: { type: String, required: true, trim: true, maxlength: 32 },
  ifcSchema: { type: String, enum: ["IFC2X3", "IFC4", "IFC4X3", "unknown"], required: true, default: "unknown" },
  modelVersion: { type: Number, required: true, min: 1 },
  checksum: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  description: { type: String, trim: true, maxlength: 1200, default: "" },
  registeredBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
bimModelSchema.index({ organizationId: 1, projectId: 1, documentId: 1, modelVersion: 1 }, { unique: true });
bimModelSchema.index({ organizationId: 1, projectId: 1, discipline: 1, updatedAt: -1 });
export const BimModel = model("BimModel", bimModelSchema);
