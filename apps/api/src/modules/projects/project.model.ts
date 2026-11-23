import { Schema, model } from "mongoose";

const projectSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  code: { type: String, required: true, trim: true, uppercase: true, maxlength: 24 },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 2000, default: "" },
  clientName: { type: String, trim: true, maxlength: 160, default: "" },
  location: { type: String, trim: true, maxlength: 240, default: "" },
  status: { type: String, enum: ["planning", "active", "on_hold", "completed", "cancelled"], default: "planning", index: true },
  startDate: { type: Date, required: true },
  targetEndDate: { type: Date, required: true },
  budget: { type: Schema.Types.Decimal128, default: "0.00" },
  currency: { type: String, uppercase: true, minlength: 3, maxlength: 3, default: "USD" },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

projectSchema.index({ organizationId: 1, code: 1 }, { unique: true });
projectSchema.index({ organizationId: 1, updatedAt: -1 });

export const Project = model("Project", projectSchema);
