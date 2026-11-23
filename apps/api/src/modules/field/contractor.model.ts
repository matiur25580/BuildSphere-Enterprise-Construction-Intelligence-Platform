import { Schema, model } from "mongoose";

const contractorSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
  companyName: { type: String, required: true, trim: true, maxlength: 160 },
  trade: { type: String, required: true, trim: true, maxlength: 100 },
  contactName: { type: String, trim: true, maxlength: 120, default: "" },
  email: { type: String, trim: true, lowercase: true, maxlength: 254, default: "" },
  phone: { type: String, trim: true, maxlength: 40, default: "" },
  status: { type: String, enum: ["active", "suspended", "completed"], default: "active", index: true },
  notes: { type: String, trim: true, maxlength: 1000, default: "" },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
contractorSchema.index({ organizationId: 1, projectId: 1, companyName: 1, trade: 1 }, { unique: true });
export const Contractor = model("Contractor", contractorSchema);
