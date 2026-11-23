import { z } from "zod";

const ifcGuid = z.string().regex(/^[0-9A-Za-z_$]{22}$/, "IFC GlobalId must be a 22-character IFC compressed GUID");
const vector = z.object({ x: z.number().finite().min(-1e9).max(1e9), y: z.number().finite().min(-1e9).max(1e9), z: z.number().finite().min(-1e9).max(1e9) }).strict();
const viewpoint = z.object({
  camera: z.object({ position: vector, direction: vector, up: vector, fieldOfView: z.number().min(1).max(179).default(60) }).strict(),
  selectedComponents: z.array(ifcGuid).max(100).default([]),
  hiddenComponents: z.array(ifcGuid).max(100).default([]),
}).strict();
export const registerBimModelSchema = z.object({
  documentId: z.string().regex(/^[a-f\d]{24}$/i),
  modelName: z.string().trim().min(2).max(160),
  discipline: z.enum(["architecture", "structure", "mechanical", "electrical", "plumbing", "civil", "landscape", "federated", "other"]),
  revision: z.string().trim().min(1).max(32),
  ifcSchema: z.enum(["IFC2X3", "IFC4", "IFC4X3", "unknown"]).default("unknown"),
  description: z.string().trim().max(1200).default(""),
});
export const createBimIssueSchema = z.object({
  modelId: z.string().regex(/^[a-f\d]{24}$/i),
  reference: z.string().trim().min(2).max(48).regex(/^[a-zA-Z0-9._/-]+$/),
  title: z.string().trim().min(2).max(180),
  description: z.string().trim().min(10).max(4000),
  issueType: z.enum(["clash", "design_query", "site_condition", "constructability", "coordination"]),
  priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  ifcGlobalId: ifcGuid.optional().default(""),
  location: z.string().trim().max(160).default(""),
  assignedToUserId: z.string().regex(/^[a-f\d]{24}$/i).nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  viewpoint: viewpoint.nullable().optional(),
});
export const updateBimIssueSchema = z.object({
  status: z.enum(["in_progress", "resolved", "closed", "reopened"]),
  comment: z.string().trim().max(2000).default(""),
});
