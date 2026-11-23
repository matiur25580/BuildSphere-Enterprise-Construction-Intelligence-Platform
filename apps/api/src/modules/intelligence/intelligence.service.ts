import mongoose from "mongoose";
import { z } from "zod";
import { Project } from "../projects/project.model.js";
import { WorkItem } from "../projects/work-item.model.js";
import { CommercialRecord } from "../commercial/commercial-record.model.js";
import { CostCode } from "../commercial/cost-code.model.js";
import { DailyReport } from "../field/daily-report.model.js";
import { Inspection } from "../delivery/inspection.model.js";
import { Ncr, Capa } from "../delivery/ncr.model.js";
import { SafetyEvent } from "../delivery/safety-event.model.js";
import { Rfi } from "../delivery/rfi.model.js";
import { Submittal } from "../delivery/submittal.model.js";
import { ProjectDocument } from "../delivery/project-document.model.js";
import { rankEvidence, scoreBudgetRisk, scoreQualityRisk, scoreSafetyRisk, scoreScheduleRisk, type EvidenceRecord } from "./intelligence.rules.js";

export const askProjectSchema = z.object({ question: z.string().trim().min(3).max(500) });
type Evidence = EvidenceRecord;
type Insight = { id: string; domain: string; severity: "critical" | "high" | "medium" | "low" | "info"; score: number; title: string; summary: string; recommendation: string; evidenceIds: string[]; confidence: "high" | "medium" | "low" | "insufficient" };
const day = (value: Date | string) => new Date(value).toISOString().slice(0, 10);
const evidence = (sourceType: string, item: any, reference: string, title: string, status: string, severity: string, date: Date | string, summary: string): Evidence => ({ id: `${sourceType}:${String(item._id)}`, sourceType, reference, title, status, severity, date: day(date), summary });
const confidenceFor = (count: number): Insight["confidence"] => count >= 5 ? "high" : count >= 2 ? "medium" : count === 1 ? "low" : "insufficient";
const insight = (id: string, domain: string, score: number, title: string, summary: string, recommendation: string, evidenceIds: string[], count = evidenceIds.length): Insight => ({ id, domain, score, severity: score >= 80 ? "critical" : score >= 60 ? "high" : score >= 35 ? "medium" : "low", title, summary, recommendation, evidenceIds, confidence: confidenceFor(count) });

export async function buildProjectIntelligence(organizationId: string, projectId: string) {
  const project = await Project.findOne({ _id: projectId, organizationId }).lean();
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  const scope = { organizationId: new mongoose.Types.ObjectId(organizationId), projectId: new mongoose.Types.ObjectId(projectId) };
  const [workItems, commercial, costCodes, reports, inspections, ncrs, capas, safety, rfis, submittals, documents] = await Promise.all([
    WorkItem.find(scope).sort({ endDate: 1 }).limit(500).lean(), CommercialRecord.find(scope).sort({ dueDate: 1 }).limit(500).lean(), CostCode.find(scope).limit(500).lean(), DailyReport.find(scope).sort({ reportDate: -1 }).limit(100).lean(), Inspection.find(scope).sort({ inspectionDate: -1 }).limit(200).lean(), Ncr.find(scope).sort({ createdAt: -1 }).limit(200).lean(), Capa.find(scope).sort({ dueDate: 1 }).limit(300).lean(), SafetyEvent.find(scope).sort({ occurredAt: -1 }).limit(200).lean(), Rfi.find(scope).sort({ dueDate: 1 }).limit(200).lean(), Submittal.find(scope).sort({ dueDate: 1 }).limit(200).lean(), ProjectDocument.find(scope).sort({ updatedAt: -1 }).limit(200).lean(),
  ]);
  const now = new Date();
  const tasks = workItems.filter((item) => item.type !== "summary");
  const activeTasks = tasks.filter((item) => item.status !== "completed");
  const overdueTasks = activeTasks.filter((item) => new Date(item.endDate) < now);
  const blockedTasks = activeTasks.filter((item) => item.status === "blocked");
  const averageProgress = tasks.length ? tasks.reduce((sum, item) => sum + item.progress, 0) / tasks.length : 0;
  const elapsed = Math.max(0, Math.min(100, ((now.getTime() - new Date(project.startDate).getTime()) / Math.max(1, new Date(project.targetEndDate).getTime() - new Date(project.startDate).getTime())) * 100));
  const scheduleGap = Math.max(0, elapsed - averageProgress);
  const scheduleScore = scoreScheduleRisk(overdueTasks.length, blockedTasks.length, scheduleGap, tasks.length > 0);
  const matchingCurrency = commercial.filter((record) => record.currency === project.currency);
  const purchaseOrders = matchingCurrency.filter((record) => record.type === "purchase_order" && ["submitted", "approved", "paid"].includes(record.status));
  const committed = purchaseOrders.reduce((sum, record) => sum + record.amount, 0);
  const commitmentRatio = project.budget > 0 ? committed / project.budget : 0;
  const budgetScore = scoreBudgetRisk(commitmentRatio, project.budget > 0);
  const overdueInvoices = matchingCurrency.filter((record) => record.type === "invoice" && ["submitted", "approved"].includes(record.status) && record.dueDate && new Date(record.dueDate) < now);
  const openNcrs = ncrs.filter((item) => item.status !== "closed");
  const criticalNcrs = openNcrs.filter((item) => item.severity === "critical");
  const majorNcrs = openNcrs.filter((item) => item.severity === "major");
  const failedInspections = inspections.filter((item) => item.items.some((check) => check.result === "fail") && item.status !== "accepted");
  const qualityScore = scoreQualityRisk(criticalNcrs.length, majorNcrs.length, openNcrs.length - criticalNcrs.length - majorNcrs.length, failedInspections.length);
  const openSafety = safety.filter((item) => item.status !== "closed");
  const criticalSafety = openSafety.filter((item) => item.severity === "critical");
  const highSafety = openSafety.filter((item) => item.severity === "high");
  const safetyScore = scoreSafetyRisk(criticalSafety.length, highSafety.length, openSafety.length - criticalSafety.length - highSafety.length);
  const overdueRfis = rfis.filter((item) => ["submitted"].includes(item.status) && item.dueDate && new Date(item.dueDate) < now);
  const overdueSubmittals = submittals.filter((item) => ["submitted", "under_review", "resubmit", "rejected"].includes(item.status) && item.dueDate && new Date(item.dueDate) < now);
  const openCapas = capas.filter((item) => item.status !== "verified");
  const overdueCapas = openCapas.filter((item) => new Date(item.dueDate) < now);
  const mismatchedCurrencies = commercial.filter((record) => record.currency !== project.currency && !["cancelled", "rejected"].includes(record.status));
  const latestReport = reports[0];
  const previousReport = reports[1];
  const fieldTrend = latestReport && previousReport ? latestReport.progressPercent - previousReport.progressPercent : null;
  const evidenceItems: Evidence[] = [
    ...overdueTasks.map((x) => evidence("work_item", x, x.code, x.title, x.status, x.status === "blocked" ? "high" : "medium", x.endDate, `Progress ${x.progress}%; planned finish ${day(x.endDate)}; assigned to ${x.assignedTo || "unassigned"}.`)),
    ...blockedTasks.map((x) => evidence("blocked_task", x, x.code, x.title, x.status, "high", x.updatedAt, `Blocked work item at ${x.progress}% progress; planned finish ${day(x.endDate)}.`)),
    ...purchaseOrders.map((x) => evidence("purchase_order", x, x.reference, x.counterparty, x.status, "medium", x.issueDate, `${project.currency} ${x.amount.toFixed(2)} · ${x.description}`)),
    ...overdueInvoices.map((x) => evidence("overdue_invoice", x, x.reference, x.counterparty, x.status, "high", x.dueDate!, `${project.currency} ${x.amount.toFixed(2)} invoice overdue since ${day(x.dueDate!)}.`)),
    ...openNcrs.map((x) => evidence("ncr", x, x.reference, x.title, x.status, x.severity, x.createdAt, x.description)),
    ...openSafety.map((x) => evidence("safety_event", x, x.reference, x.title, x.status, x.severity, x.occurredAt, `${x.type}: ${x.description}`)),
    ...openCapas.map((x) => evidence("capa", x, String(x._id), x.type, x.status, new Date(x.dueDate) < now ? "high" : "medium", x.dueDate, `${x.owner}: ${x.description}`)),
    ...overdueRfis.map((x) => evidence("rfi", x, x.reference, x.subject, x.status, "medium", x.dueDate!, x.question)),
    ...overdueSubmittals.map((x) => evidence("submittal", x, x.reference, x.title, x.status, "medium", x.dueDate!, `Revision ${x.revision}. ${x.reviewerResponse}`)),
    ...failedInspections.map((x) => evidence("inspection", x, x.reference, x.title, x.status, "high", x.inspectionDate, x.items.filter((i) => i.result === "fail").map((i) => i.label).join("; "))),
    ...documents.filter((x) => x.approvalStatus === "submitted" || x.approvalStatus === "revision_requested").map((x) => evidence("document", x, x.documentNo, x.title, x.approvalStatus, "medium", x.updatedAt, `Current version ${x.currentVersion}; approval ${x.approvalStatus}.`)),
  ].slice(0, 120);
  const evidenceFor = (types: string[]) => evidenceItems.filter((item) => types.includes(item.sourceType)).map((item) => item.id).slice(0, 30);
  const insights: Insight[] = [];
  if (tasks.length) insights.push(insight("schedule-risk", "schedule", scheduleScore, scheduleScore >= 60 ? "Schedule pressure detected" : scheduleScore >= 35 ? "Schedule watchlist" : "Schedule tracking", `${overdueTasks.length} overdue and ${blockedTasks.length} blocked work items. Recorded task progress is ${Math.round(averageProgress)}% versus ${Math.round(elapsed)}% elapsed project time (gap ${Math.round(scheduleGap)} percentage points).`, "Review overdue and blocked tasks, confirm predecessor constraints, and re-baseline dates only after validating the recovery plan.", evidenceFor(["work_item", "blocked_task"]), overdueTasks.length + blockedTasks.length));
  if (project.budget > 0) insights.push(insight("budget-risk", "commercial", budgetScore, budgetScore >= 80 ? "Budget commitment threshold breached" : budgetScore >= 60 ? "Budget commitments need attention" : "Budget commitment tracking", `${project.currency} ${committed.toFixed(2)} in submitted, approved or paid purchase orders against ${project.currency} ${project.budget.toFixed(2)} budget (${Math.round(commitmentRatio * 100)}%). ${overdueInvoices.length} overdue invoices in the project currency.`, "Reconcile open commitments and forecast remaining cost before approving additional purchase orders. Check invoice due dates with the commercial team.", evidenceFor(["purchase_order", "overdue_invoice"]), purchaseOrders.length + overdueInvoices.length));
  if (openNcrs.length || failedInspections.length) insights.push(insight("quality-risk", "quality", qualityScore, "Quality non-conformance exposure", `${openNcrs.length} open NCRs (${criticalNcrs.length} critical, ${majorNcrs.length} major) and ${failedInspections.length} inspections with failed checklist items awaiting acceptance. ${overdueCapas.length} CAPA actions are overdue.`, "Prioritize critical NCRs, assign accountable owners to overdue CAPAs, and require verification evidence before closure.", evidenceFor(["ncr", "inspection", "capa"]), openNcrs.length + failedInspections.length));
  if (openSafety.length) insights.push(insight("safety-risk", "safety", safetyScore, "Open site safety exposure", `${openSafety.length} open safety events include ${criticalSafety.length} critical and ${highSafety.length} high-severity reports.`, "Escalate critical/high events to the site safety lead immediately, confirm interim controls, and record closure evidence.", evidenceFor(["safety_event"]), openSafety.length));
  if (overdueRfis.length || overdueSubmittals.length) insights.push(insight("information-flow", "coordination", Math.min(100, overdueRfis.length * 18 + overdueSubmittals.length * 15), "Design information may be constraining delivery", `${overdueRfis.length} submitted RFIs and ${overdueSubmittals.length} submitted/review/resubmit submittals have passed their due dates.`, "Confirm response owners and required-by dates; assess affected work packages before changing the programme.", evidenceFor(["rfi", "submittal"]), overdueRfis.length + overdueSubmittals.length));
  if (mismatchedCurrencies.length) insights.push(insight("currency-review", "commercial", 35, "Commercial records use multiple currencies", `${mismatchedCurrencies.length} active commercial records use a currency other than the project currency (${project.currency}); they are excluded from the commitment ratio.`, "Confirm the project reporting currency and apply an approved exchange-rate policy before aggregating exposure.", evidenceItems.filter((x) => x.sourceType === "purchase_order").map((x) => x.id), mismatchedCurrencies.length));
  if (!insights.length) insights.push(insight("no-material-alerts", "overview", 0, "No material risk signals found in current records", "The available records did not trigger the configured schedule, commercial, quality, safety or information-flow thresholds. This is not a guarantee of project health.", "Keep source records current and review the evidence set regularly; unrecorded site conditions are not visible to this analysis.", [], 0));
  const metrics = { workItems: tasks.length, averageTaskProgress: Math.round(averageProgress), overdueTasks: overdueTasks.length, blockedTasks: blockedTasks.length, elapsedProjectPercent: Math.round(elapsed), committedPurchaseOrders: Number(committed.toFixed(2)), projectBudget: project.budget, commitmentPercent: project.budget > 0 ? Math.round(commitmentRatio * 100) : null, overdueInvoices: overdueInvoices.length, openNcrs: openNcrs.length, overdueCapas: overdueCapas.length, openSafetyEvents: openSafety.length, overdueRfis: overdueRfis.length, overdueSubmittals: overdueSubmittals.length, evidenceCount: evidenceItems.length, latestFieldReportDate: latestReport ? day(latestReport.reportDate) : null, latestFieldProgress: latestReport?.progressPercent ?? null, fieldProgressChange: fieldTrend };
  return { generatedAt: now.toISOString(), methodology: "Explainable deterministic rules over project records; not a predictive ML model.", project: { id: String(project._id), code: project.code, name: project.name, currency: project.currency }, metrics, insights: insights.sort((a, b) => b.score - a.score), evidence: evidenceItems };
}

export function answerFromEvidence(question: string, evidenceItems: Evidence[]) {
  const { tokens, scored } = rankEvidence(question, evidenceItems);
  if (!tokens.length || !scored.length) return { answer: "I could not find a matching record in the current project evidence. Try asking about overdue tasks, purchase orders, NCRs, safety events, RFIs, submittals, CAPA actions or document approvals.", matchedCount: 0, evidence: [] };
  const lines = scored.map(({ item }) => `${item.reference} — ${item.title} [${item.status}${item.severity !== "none" ? ` / ${item.severity}` : ""}], dated ${item.date}: ${item.summary}`);
  return { answer: `Found ${scored.length} matching project record(s). These are retrieved source facts, not generated conclusions:\\n${lines.join("\\n")}`, matchedCount: scored.length, evidence: scored.map(({ item, matches }) => ({ ...item, matchedTerms: matches })) };
}
