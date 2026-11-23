import { Schema, model } from "mongoose";

const projectMembershipSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
  projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  role: { type: String, enum: ["project_manager", "contributor", "viewer"], required: true, default: "contributor" },
  status: { type: String, enum: ["active", "inactive"], required: true, default: "active" },
  addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

projectMembershipSchema.index({ organizationId: 1, projectId: 1, userId: 1 }, { unique: true });
projectMembershipSchema.index({ organizationId: 1, projectId: 1, status: 1, role: 1 });

export const ProjectMembership = model("ProjectMembership", projectMembershipSchema);
