import type { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../../common/async-handler.js";
import { HttpError } from "../../common/http-error.js";
import { Project } from "../projects/project.model.js";
import { CostCode } from "./cost-code.model.js";
import { CommercialRecord } from "./commercial-record.model.js";
import { createCostCodeSchema, createCommercialRecordSchema, updateCommercialStatusSchema } from "./commercial.schemas.js";

const authContext = (request: Request) => {
  if (!request.auth) throw new HttpError(401, "Authentication required");
  return request.auth;
};
const projectFor = async (projectId: string, organizationId: string) => {
  const project = await Project.findOne({ _id: projectId, organizationId });
  if (!project) throw new HttpError(404, "Project not found");
  return project;
};

export const listCostCodes = asyncHandler(async (request: Request, response: Response) => {
  const auth = authContext(request);
  await projectFor(request.params.projectId, auth.organizationId);
  const items = await CostCode.find({ organizationId: auth.organizationId, projectId: request.params.projectId }).sort({ code: 1 }).lean();
  response.json({ success: true, data: items });
});
export const createCostCode = asyncHandler(async (request: Request, response: Response) => {
  const auth = authContext(request);
  await projectFor(request.params.projectId, auth.organizationId);
  const input = createCostCodeSchema.parse(request.body);
  const item = await CostCode.create({ ...input, organizationId: auth.organizationId, projectId: request.params.projectId });
  response.status(201).json({ success: true, data: item });
});
export const listRecords = asyncHandler(async (request: Request, response: Response) => {
  const auth = authContext(request);
  await projectFor(request.params.projectId, auth.organizationId);
  const filter: Record<string, unknown> = { organizationId: auth.organizationId, projectId: request.params.projectId };
  if (typeof request.query.type === "string" && ["purchase_order", "invoice", "payment_claim"].includes(request.query.type)) filter.type = request.query.type;
  const records = await CommercialRecord.find(filter).populate("costCodeId", "code name").sort({ issueDate: -1, createdAt: -1 }).lean();
  response.json({ success: true, data: records });
});
export const createRecord = asyncHandler(async (request: Request, response: Response) => {
  const auth = authContext(request);
  await projectFor(request.params.projectId, auth.organizationId);
  const input = createCommercialRecordSchema.parse(request.body);
  if (input.costCodeId) {
    const code = await CostCode.exists({ _id: input.costCodeId, projectId: request.params.projectId, organizationId: auth.organizationId, isActive: true });
    if (!code) throw new HttpError(400, "Cost code must be active and belong to this project");
  }
  const record = await CommercialRecord.create({ ...input, costCodeId: input.costCodeId || null, organizationId: auth.organizationId, projectId: request.params.projectId, createdBy: auth.userId });
  response.status(201).json({ success: true, data: record });
});
export const updateRecordStatus = asyncHandler(async (request: Request, response: Response) => {
  const auth = authContext(request);
  const input = updateCommercialStatusSchema.parse(request.body);
  const record = await CommercialRecord.findOne({ _id: request.params.recordId, projectId: request.params.projectId, organizationId: auth.organizationId });
  if (!record) throw new HttpError(404, "Commercial record not found");
  const allowed: Record<string, string[]> = {
    draft: ["submitted", "cancelled"], submitted: ["approved", "rejected", "cancelled"],
    approved: ["paid", "cancelled"], rejected: ["draft", "cancelled"], paid: [], cancelled: [],
  };
  if (!allowed[record.status]?.includes(input.status)) throw new HttpError(400, "Invalid commercial status transition");
  record.status = input.status;
  if (input.notes !== undefined) record.notes = input.notes;
  await record.save();
  response.json({ success: true, data: record });
});
export const getCommercialSummary = asyncHandler(async (request: Request, response: Response) => {
  const auth = authContext(request);
  const project = await projectFor(request.params.projectId, auth.organizationId);
  const orgId = new mongoose.Types.ObjectId(auth.organizationId);
  const projectId = new mongoose.Types.ObjectId(request.params.projectId);
  const [codes, records] = await Promise.all([
    CostCode.aggregate([{ $match: { organizationId: orgId, projectId, isActive: true } }, { $group: { _id: null, allocatedBudget: { $sum: "$budget" }, count: { $sum: 1 } } }]),
    CommercialRecord.aggregate([
      { $match: { organizationId: orgId, projectId, status: { $nin: ["rejected", "cancelled"] } } },
      { $group: { _id: { type: "$type", status: "$status" }, amount: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
  ]);
  const totals = { purchaseOrders: 0, invoices: 0, paymentClaims: 0, paid: 0, pending: 0 };
  for (const row of records) {
    if (row._id.type === "purchase_order") totals.purchaseOrders += row.amount;
    if (row._id.type === "invoice") totals.invoices += row.amount;
    if (row._id.type === "payment_claim") totals.paymentClaims += row.amount;
    if (row._id.status === "paid") totals.paid += row.amount;
    else totals.pending += row.amount;
  }
  response.json({ success: true, data: { projectBudget: project.budget, allocatedBudget: codes[0]?.allocatedBudget ?? 0, costCodeCount: codes[0]?.count ?? 0, ...totals, remainingBudget: project.budget - totals.purchaseOrders } });
});
