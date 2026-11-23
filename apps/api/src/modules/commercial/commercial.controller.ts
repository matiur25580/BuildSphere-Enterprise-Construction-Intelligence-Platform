import type { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../../common/async-handler.js";
import { HttpError } from "../../common/http-error.js";
import { Project } from "../projects/project.model.js";
import { CostCode } from "./cost-code.model.js";
import { CommercialRecord } from "./commercial-record.model.js";
import { runProjectMutationWithEvent } from "../collaboration/collaboration.service.js";
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

const decimalUnits = (value: unknown): bigint => {
  const [whole = "0", fraction = ""] = String(value ?? "0").split(".");
  return BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, "0").slice(0, 4));
};
const decimalString = (units: bigint): string => {
  const whole = units / 10_000n;
  const fraction = (units % 10_000n).toString().padStart(4, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
};
const addDecimal = (left: unknown, right: unknown): string => decimalString(decimalUnits(left) + decimalUnits(right));
const subtractDecimal = (left: unknown, right: unknown): string => decimalString(decimalUnits(left) - decimalUnits(right));
const asDecimalString = (value: unknown): string => String(value ?? "0");

export const listCostCodes = asyncHandler(async (request: Request, response: Response) => {
  const auth = authContext(request);
  await projectFor(String(request.params.projectId), auth.organizationId);
  const items = await CostCode.find({ organizationId: auth.organizationId, projectId: String(request.params.projectId) }).sort({ code: 1 }).lean();
  response.json({ success: true, data: items.map((item) => ({ ...item, budget: asDecimalString(item.budget) })) });
});
export const createCostCode = asyncHandler(async (request: Request, response: Response) => {
  const auth = authContext(request);
  await projectFor(String(request.params.projectId), auth.organizationId);
  const input = createCostCodeSchema.parse(request.body);
  const item = await CostCode.create({ ...input, organizationId: auth.organizationId, projectId: String(request.params.projectId) });
  response.status(201).json({ success: true, data: { ...item.toObject(), budget: asDecimalString(item.budget) } });
});
export const listRecords = asyncHandler(async (request: Request, response: Response) => {
  const auth = authContext(request);
  await projectFor(String(request.params.projectId), auth.organizationId);
  const filter: Record<string, unknown> = { organizationId: auth.organizationId, projectId: String(request.params.projectId) };
  if (typeof request.query.type === "string" && ["purchase_order", "invoice", "payment_claim"].includes(request.query.type)) filter.type = request.query.type;
  const records = await CommercialRecord.find(filter).populate("costCodeId", "code name").sort({ issueDate: -1, createdAt: -1 }).lean();
  response.json({ success: true, data: records.map((record) => ({ ...record, amount: asDecimalString(record.amount) })) });
});
export const createRecord = asyncHandler(async (request: Request, response: Response) => {
  const auth = authContext(request);
  await projectFor(String(request.params.projectId), auth.organizationId);
  const input = createCommercialRecordSchema.parse(request.body);
  if (input.costCodeId) {
    const code = await CostCode.exists({ _id: input.costCodeId, projectId: String(request.params.projectId), organizationId: auth.organizationId, isActive: true });
    if (!code) throw new HttpError(400, "Cost code must be active and belong to this project");
  }
  const record = new CommercialRecord({ ...input, costCodeId: input.costCodeId || null, organizationId: auth.organizationId, projectId: String(request.params.projectId), createdBy: auth.userId });
  await runProjectMutationWithEvent({ organizationId: auth.organizationId, projectId: String(request.params.projectId), actorId: auth.userId, eventType: "commercial.record_created", targetType: "commercial_record", targetId: String(record._id), summary: `${record.type.replace("_", " ")} record created` }, (session) => record.save(session ? { session } : {}));
  response.status(201).json({ success: true, data: { ...record.toObject(), amount: asDecimalString(record.amount) } });
});
export const updateRecordStatus = asyncHandler(async (request: Request, response: Response) => {
  const auth = authContext(request);
  const input = updateCommercialStatusSchema.parse(request.body);
  const record = await CommercialRecord.findOne({ _id: String(request.params.recordId), projectId: String(request.params.projectId), organizationId: auth.organizationId });
  if (!record) throw new HttpError(404, "Commercial record not found");
  const allowed: Record<string, string[]> = {
    draft: ["submitted", "cancelled"], submitted: ["approved", "rejected", "cancelled"],
    approved: ["paid", "cancelled"], rejected: ["draft", "cancelled"], paid: [], cancelled: [],
  };
  if (!allowed[record.status]?.includes(input.status)) throw new HttpError(400, "Invalid commercial status transition");
  record.status = input.status;
  if (input.notes !== undefined) record.notes = input.notes;
  await runProjectMutationWithEvent({ organizationId: auth.organizationId, projectId: String(request.params.projectId), actorId: auth.userId, eventType: "commercial.status_changed", targetType: "commercial_record", targetId: String(record._id), summary: `Commercial record status changed to ${record.status}` }, (session) => record.save(session ? { session } : {}));
  response.json({ success: true, data: { ...record.toObject(), amount: asDecimalString(record.amount) } });
});
export const getCommercialSummary = asyncHandler(async (request: Request, response: Response) => {
  const auth = authContext(request);
  const project = await projectFor(String(request.params.projectId), auth.organizationId);
  const orgId = new mongoose.Types.ObjectId(auth.organizationId);
  const projectId = new mongoose.Types.ObjectId(String(request.params.projectId));
  const [codes, records] = await Promise.all([
    CostCode.aggregate([
      { $match: { organizationId: orgId, projectId, isActive: true } },
      { $group: { _id: "$currency", allocatedBudget: { $sum: "$budget" }, count: { $sum: 1 } } },
    ]),
    CommercialRecord.aggregate([
      { $match: { organizationId: orgId, projectId, status: { $nin: ["rejected", "cancelled"] } } },
      { $group: { _id: { currency: "$currency", type: "$type", status: "$status" }, amount: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
  ]);

  type CurrencyTotals = { currency: string; allocatedBudget: string; purchaseOrders: string; invoices: string; paymentClaims: string; paid: string; pending: string; costCodeCount: number };
  const byCurrency = new Map<string, CurrencyTotals>();
  const getTotals = (currency: string): CurrencyTotals => {
    let totals = byCurrency.get(currency);
    if (!totals) {
      totals = { currency, allocatedBudget: "0", purchaseOrders: "0", invoices: "0", paymentClaims: "0", paid: "0", pending: "0", costCodeCount: 0 };
      byCurrency.set(currency, totals);
    }
    return totals;
  };

  for (const row of codes) {
    const totals = getTotals(String(row._id));
    totals.allocatedBudget = asDecimalString(row.allocatedBudget);
    totals.costCodeCount = row.count;
  }
  for (const row of records) {
    const totals = getTotals(String(row._id.currency));
    const amount = asDecimalString(row.amount);
    if (row._id.type === "purchase_order") totals.purchaseOrders = addDecimal(totals.purchaseOrders, amount);
    if (row._id.type === "invoice") totals.invoices = addDecimal(totals.invoices, amount);
    if (row._id.type === "payment_claim") totals.paymentClaims = addDecimal(totals.paymentClaims, amount);
    if (row._id.status === "paid") totals.paid = addDecimal(totals.paid, amount);
    else totals.pending = addDecimal(totals.pending, amount);
  }

  const projectCurrency = project.currency;
  const projectTotals = getTotals(projectCurrency);
  response.json({
    success: true,
    data: {
      currency: projectCurrency,
      projectBudget: asDecimalString(project.budget),
      allocatedBudget: projectTotals.allocatedBudget,
      costCodeCount: [...byCurrency.values()].reduce((sum, item) => sum + item.costCodeCount, 0),
      purchaseOrders: projectTotals.purchaseOrders,
      invoices: projectTotals.invoices,
      paymentClaims: projectTotals.paymentClaims,
      paid: projectTotals.paid,
      pending: projectTotals.pending,
      remainingBudget: subtractDecimal(asDecimalString(project.budget), projectTotals.purchaseOrders),
      currencyBreakdown: [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    },
  });
});
