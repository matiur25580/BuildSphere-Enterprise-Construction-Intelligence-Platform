import { z } from "zod";

const dateValue = z.coerce.date();
export const createProjectSchema = z.object({
  code: z.string().trim().min(2).max(24).regex(/^[a-zA-Z0-9-]+$/),
  name: z.string().trim().min(2).max(160),
  description: z.string().max(2000).optional(),
  clientName: z.string().max(160).optional(),
  location: z.string().max(240).optional(),
  startDate: dateValue,
  targetEndDate: dateValue,
  budget: z.coerce.number().min(0).default(0),
  currency: z.string().length(3).default("USD"),
}).refine((value) => value.targetEndDate >= value.startDate, {
  message: "Target end date must be on or after the start date",
  path: ["targetEndDate"],
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  description: z.string().max(2000).optional(),
  clientName: z.string().max(160).optional(),
  location: z.string().max(240).optional(),
  status: z.enum(["planning", "active", "on_hold", "completed", "cancelled"]).optional(),
  startDate: dateValue.optional(),
  targetEndDate: dateValue.optional(),
  budget: z.coerce.number().min(0).optional(),
  currency: z.string().length(3).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const createWorkItemSchema = z.object({
  parentId: z.string().optional().nullable(),
  code: z.string().trim().min(1).max(32),
  title: z.string().trim().min(2).max(180),
  description: z.string().max(2000).optional(),
  type: z.enum(["summary", "task", "milestone"]).default("task"),
  status: z.enum(["not_started", "in_progress", "blocked", "completed"]).default("not_started"),
  startDate: dateValue,
  endDate: dateValue,
  progress: z.coerce.number().min(0).max(100).default(0),
  assignedTo: z.string().max(120).optional(),
  assignedUserId: z.string().regex(/^[a-f\\d]{24}$/i).nullable().optional(),
  predecessorIds: z.array(z.string()).default([]),
}).refine((value) => value.endDate >= value.startDate, {
  message: "End date must be on or after the start date",
  path: ["endDate"],
});

export const updateWorkItemSchema = z.object({
  title: z.string().trim().min(2).max(180).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(["not_started", "in_progress", "blocked", "completed"]).optional(),
  startDate: dateValue.optional(),
  endDate: dateValue.optional(),
  progress: z.coerce.number().min(0).max(100).optional(),
  assignedTo: z.string().max(120).optional(),
  assignedUserId: z.string().regex(/^[a-f\\d]{24}$/i).nullable().optional(),
  predecessorIds: z.array(z.string()).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
