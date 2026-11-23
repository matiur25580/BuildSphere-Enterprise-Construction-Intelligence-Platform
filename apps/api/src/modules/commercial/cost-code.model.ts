import { Schema, model } from "mongoose";

const costCodeSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
  code: { type: String, required: true, trim: true, uppercase: true, maxlength: 32 },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 500, default: "" },
  budget: { type: Schema.Types.Decimal128, required: true, default: "0.00" },
  currency: { type: String, uppercase: true, minlength: 3, maxlength: 3, default: "USD" },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });
costCodeSchema.index({ organizationId: 1, projectId: 1, code: 1 }, { unique: true });
export const CostCode = model("CostCode", costCodeSchema);
