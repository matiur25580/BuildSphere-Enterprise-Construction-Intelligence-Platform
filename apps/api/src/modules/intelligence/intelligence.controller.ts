import type { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../../common/async-handler.js";
import { HttpError } from "../../common/http-error.js";
import { Project } from "../projects/project.model.js";
import { answerFromEvidence, askProjectSchema, buildProjectIntelligence } from "./intelligence.service.js";

const context = (request: Request) => { if (!request.auth) throw new HttpError(401, "Authentication required"); return request.auth; };
const projectContext = async (request: Request) => {
  const auth = context(request); const projectId = String(request.params.projectId);
  if (!mongoose.isValidObjectId(projectId)) throw new HttpError(404, "Project not found");
  const project = await Project.exists({ _id: projectId, organizationId: auth.organizationId });
  if (!project) throw new HttpError(404, "Project not found");
  return { organizationId: auth.organizationId, projectId };
};

export const getProjectInsights = asyncHandler(async (request: Request, response: Response) => {
  const { organizationId, projectId } = await projectContext(request);
  const result = await buildProjectIntelligence(organizationId, projectId);
  response.json({ success: true, data: result });
});

export const askProjectEvidence = asyncHandler(async (request: Request, response: Response) => {
  const { organizationId, projectId } = await projectContext(request);
  const input = askProjectSchema.parse(request.body);
  const result = await buildProjectIntelligence(organizationId, projectId);
  response.json({ success: true, data: { project: result.project, generatedAt: result.generatedAt, methodology: "Keyword retrieval over current tenant-scoped project records; no external LLM is called.", ...answerFromEvidence(input.question, result.evidence) } });
});
