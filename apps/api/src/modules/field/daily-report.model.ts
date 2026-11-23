import { Schema, model } from "mongoose";

const workforceSchema = new Schema({
  trade: { type: String, required: true, trim: true, maxlength: 100 },
  contractorId: { type: Schema.Types.ObjectId, ref: "Contractor", default: null },
  headcount: { type: Number, required: true, min: 0, max: 10000 },
}, { _id: false });
const equipmentSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  quantity: { type: Number, required: true, min: 0, max: 10000 },
  hoursUsed: { type: Number, required: true, min: 0, max: 24 },
  condition: { type: String, enum: ["operational", "maintenance", "out_of_service"], default: "operational" },
}, { _id: false });
const photoSchema = new Schema({
  url: { type: String, required: true, maxlength: 2048 },
  caption: { type: String, trim: true, maxlength: 240, default: "" },
  capturedAt: { type: Date, default: null },
  latitude: { type: Number, min: -90, max: 90, default: null },
  longitude: { type: Number, min: -180, max: 180, default: null },
}, { _id: false });
const dailyReportSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
  reportDate: { type: Date, required: true },
  shift: { type: String, enum: ["day", "night"], default: "day" },
  weather: { type: String, trim: true, maxlength: 80, default: "" },
  temperatureC: { type: Number, min: -60, max: 65, default: null },
  workPerformed: { type: String, required: true, trim: true, maxlength: 5000 },
  progressPercent: { type: Number, min: 0, max: 100, default: 0 },
  workforce: { type: [workforceSchema], default: [] },
  equipment: { type: [equipmentSchema], default: [] },
  safetyObservations: { type: String, trim: true, maxlength: 3000, default: "" },
  delaysAndIssues: { type: String, trim: true, maxlength: 3000, default: "" },
  photos: { type: [photoSchema], default: [] },
  siteLatitude: { type: Number, min: -90, max: 90, default: null },
  siteLongitude: { type: Number, min: -180, max: 180, default: null },
  submittedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
dailyReportSchema.index({ organizationId: 1, projectId: 1, reportDate: -1 });
dailyReportSchema.index({ organizationId: 1, projectId: 1, reportDate: 1, shift: 1 }, { unique: true });
export const DailyReport = model("DailyReport", dailyReportSchema);
