import { Schema, model } from "mongoose";

const commercialRecordSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
  costCodeId: { type: Schema.Types.ObjectId, ref: "CostCode", default: null },
  type: { type: String, enum: ["purchase_order", "invoice", "payment_claim"], required: true, index: true },
  reference: { type: String, required: true, trim: true, uppercase: true, maxlength: 48 },
  counterparty: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 1000, default: "" },
  amount: { type: Schema.Types.Decimal128, min: "0.0001", required: true },
  currency: { type: String, uppercase: true, minlength: 3, maxlength: 3, default: "USD" },
  issueDate: { type: Date, required: true },
  dueDate: { type: Date, default: null },
  status: { type: String, enum: ["draft", "submitted", "approved", "rejected", "paid", "cancelled"], default: "draft", index: true },
  notes: { type: String, trim: true, maxlength: 1000, default: "" },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
commercialRecordSchema.index({ organizationId: 1, projectId: 1, type: 1, reference: 1 }, { unique: true });
commercialRecordSchema.index({ organizationId: 1, projectId: 1, issueDate: -1 });
export const CommercialRecord = model("CommercialRecord", commercialRecordSchema);
