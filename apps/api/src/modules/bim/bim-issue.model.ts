import { Schema, model } from "mongoose";

const vectorSchema = new Schema({ x: { type: Number, required: true, min: -1e9, max: 1e9 }, y: { type: Number, required: true, min: -1e9, max: 1e9 }, z: { type: Number, required: true, min: -1e9, max: 1e9 } }, { _id: false });
const viewpointSchema = new Schema({
  camera: {
    position: { type: vectorSchema, required: true },
    direction: { type: vectorSchema, required: true },
    up: { type: vectorSchema, required: true },
    fieldOfView: { type: Number, min: 1, max: 179, default: 60 },
  },
  selectedComponents: { type: [String], default: [], validate: (values: string[]) => values.length <= 100 },
  hiddenComponents: { type: [String], default: [], validate: (values: string[]) => values.length <= 100 },
}, { _id: false });

const historySchema = new Schema({
  status: { type: String, enum: ["open", "in_progress", "resolved", "closed", "reopened"], required: true },
  comment: { type: String, trim: true, maxlength: 2000, default: "" },
  actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  actedAt: { type: Date, default: Date.now },
}, { _id: false });

const bimIssueSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
  modelId: { type: Schema.Types.ObjectId, ref: "BimModel", required: true, index: true },
  modelVersion: { type: Number, required: true, min: 1 },
  reference: { type: String, required: true, trim: true, uppercase: true, maxlength: 48 },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  description: { type: String, required: true, trim: true, maxlength: 4000 },
  issueType: { type: String, enum: ["clash", "design_query", "site_condition", "constructability", "coordination"], required: true },
  priority: { type: String, enum: ["low", "normal", "high", "critical"], required: true, default: "normal" },
  status: { type: String, enum: ["open", "in_progress", "resolved", "closed", "reopened"], required: true, default: "open", index: true },
  ifcGlobalId: { type: String, trim: true, maxlength: 22, default: "" },
  location: { type: String, trim: true, maxlength: 160, default: "" },
  assignedToUserId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
  dueDate: { type: Date, default: null },
  viewpoint: { type: viewpointSchema, default: null },
  history: { type: [historySchema], default: [] },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
bimIssueSchema.index({ organizationId: 1, projectId: 1, reference: 1 }, { unique: true });
bimIssueSchema.index({ organizationId: 1, projectId: 1, modelId: 1, status: 1, priority: 1 });
bimIssueSchema.index({ organizationId: 1, projectId: 1, ifcGlobalId: 1 });
export const BimIssue = model("BimIssue", bimIssueSchema);
