import { z } from "zod";

export const createCostCodeSchema = z.object({
  code: z.string().trim().min(1).max(32).regex(/^[a-zA-Z0-9._-]+$/),
  name: z.string().trim().min(2).max(160),
  description: z.string().max(500).optional(),
  budget: z.coerce.number().min(0),
  currency: z.string().length(3).default("USD"),
});
export const createCommercialRecordSchema = z.object({
  type: z.enum(["purchase_order", "invoice", "payment_claim"]),
  costCodeId: z.string().optional().nullable(),
  reference: z.string().trim().min(1).max(48).regex(/^[a-zA-Z0-9._/-]+$/),
  counterparty: z.string().trim().min(2).max(160),
  description: z.string().max(1000).optional(),
  amount: z.coerce.number().positive(),
  currency: z.string().length(3).default("USD"),
  issueDate: z.coerce.date(),
  dueDate: z.coerce.date().optional().nullable(),
  notes: z.string().max(1000).optional(),
}).refine((value) => !value.dueDate || value.dueDate >= value.issueDate, { message: "Due date cannot be before issue date", path: ["dueDate"] });
export const updateCommercialStatusSchema = z.object({
  status: z.enum(["draft", "submitted", "approved", "rejected", "paid", "cancelled"]),
  notes: z.string().max(1000).optional(),
});
