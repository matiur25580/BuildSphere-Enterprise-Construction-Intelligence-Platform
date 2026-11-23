import type { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../../common/async-handler.js";
import { HttpError } from "../../common/http-error.js";
import { Project } from "../projects/project.model.js";
import { Contractor } from "./contractor.model.js";
import { DailyReport } from "./daily-report.model.js";
import { createContractorSchema, updateContractorSchema, createDailyReportSchema } from "./field.schemas.js";

const context = (request: Request) => {
  if (!request.auth) throw new HttpError(401, "Authentication required");
  return request.auth;
};
const projectFor = async (projectId: string, organizationId: string) => {
  const project = await Project.findOne({ _id: projectId, organizationId });
  if (!project) throw new HttpError(404, "Project not found");
  return project;
};
export const listContractors = asyncHandler(async (request: Request, response: Response) => {
  const auth = context(request);
  await projectFor(String(request.params.projectId), auth.organizationId);
  const items = await Contractor.find({ organizationId: auth.organizationId, projectId: String(request.params.projectId) }).sort({ companyName: 1 }).lean();
  response.json({ success: true, data: items });
});
export const createContractor = asyncHandler(async (request: Request, response: Response) => {
  const auth = context(request);
  const projectId = String(request.params.projectId);
  await projectFor(projectId, auth.organizationId);
  const input = createContractorSchema.parse(request.body);
  const contractor = await Contractor.create({ ...input, organizationId: auth.organizationId, projectId, createdBy: auth.userId });
  response.status(201).json({ success: true, data: contractor });
});
export const updateContractor = asyncHandler(async (request: Request, response: Response) => {
  const auth = context(request);
  const input = updateContractorSchema.parse(request.body);
  const contractor = await Contractor.findOne({ _id: String(request.params.contractorId), projectId: String(request.params.projectId), organizationId: auth.organizationId });
  if (!contractor) throw new HttpError(404, "Contractor not found");
  Object.assign(contractor, input);
  await contractor.save();
  response.json({ success: true, data: contractor });
});
export const listDailyReports = asyncHandler(async (request: Request, response: Response) => {
  const auth = context(request);
  const projectId = String(request.params.projectId);
  await projectFor(projectId, auth.organizationId);
  const reports = await DailyReport.find({ organizationId: auth.organizationId, projectId }).sort({ reportDate: -1, shift: 1 }).limit(100).populate("workforce.contractorId", "companyName trade").lean();
  response.json({ success: true, data: reports });
});
export const createDailyReport = asyncHandler(async (request: Request, response: Response) => {
  const auth = context(request);
  const projectId = String(request.params.projectId);
  const project = await projectFor(projectId, auth.organizationId);
  const input = createDailyReportSchema.parse(request.body);
  const reportDate = new Date(input.reportDate);
  reportDate.setUTCHours(0, 0, 0, 0);
  if (reportDate < new Date(new Date(project.startDate).setUTCHours(0, 0, 0, 0)) || reportDate > new Date(new Date(project.targetEndDate).setUTCHours(0, 0, 0, 0))) {
    throw new HttpError(400, "Report date must fall within the project date range");
  }
  const contractorIds = [...new Set(input.workforce.map((item) => item.contractorId).filter((id): id is string => Boolean(id)))];
  if (contractorIds.length) {
    const count = await Contractor.countDocuments({ _id: { $in: contractorIds }, projectId, organizationId: auth.organizationId, status: "active" });
    if (count !== contractorIds.length) throw new HttpError(400, "Every workforce contractor must be active and belong to this project");
  }
  const report = await DailyReport.create({ ...input, reportDate, organizationId: auth.organizationId, projectId, submittedBy: auth.userId });
  response.status(201).json({ success: true, data: report });
});
export const getFieldSummary = asyncHandler(async (request: Request, response: Response) => {
  const auth = context(request);
  const projectId = String(request.params.projectId);
  await projectFor(projectId, auth.organizationId);
  const organizationId = new mongoose.Types.ObjectId(auth.organizationId);
  const projectObjectId = new mongoose.Types.ObjectId(projectId);
  const [contractorCount, reportCount, latest, totals] = await Promise.all([
    Contractor.countDocuments({ organizationId, projectId, status: "active" }),
    DailyReport.countDocuments({ organizationId, projectId }),
    DailyReport.findOne({ organizationId, projectId }).sort({ reportDate: -1, createdAt: -1 }).select("reportDate progressPercent weather workforce equipment safetyObservations delaysAndIssues").lean(),
    DailyReport.aggregate([
      { $match: { organizationId, projectId: projectObjectId } },
      { $group: { _id: null, reports: { $sum: 1 }, totalWorkers: { $sum: { $sum: "$workforce.headcount" } }, equipmentHours: { $sum: { $sum: "$equipment.hoursUsed" } }, averageProgress: { $avg: "$progressPercent" } } },
    ]),
  ]);
  response.json({ success: true, data: { activeContractors: contractorCount, reportCount, latestReport: latest, totalWorkersLogged: totals[0]?.totalWorkers ?? 0, equipmentHoursLogged: totals[0]?.equipmentHours ?? 0, averageReportedProgress: Math.round(totals[0]?.averageProgress ?? 0) } });
});
