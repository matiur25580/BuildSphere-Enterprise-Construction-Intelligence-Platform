import { z } from "zod";

// Decimal strings avoid binary floating-point rounding. Numeric inputs remain accepted
// for compatibility with existing clients, but new clients should send strings.
const decimalValue = z.preprocess(
  (value) => typeof value === "number" && Number.isFinite(value) ? value.toString() : value,
  z.string().regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/, "Enter a non-negative amount with up to 4 decimal places"),
);
const positiveDecimalValue = decimalValue.refine((value) => /[1-9]/.test(value), "Amount must be greater than zero");
const currencyCode = z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase());

export const createCostCodeSchema = z.object({
  code: z.string().trim().min(1).max(32).regex(/^[a-zA-Z0-9._-]+$/),
  name: z.string().trim().min(2).max(160),
  description: z.string().max(500).optional(),
  budget: decimalValue,
  currency: currencyCode.default("USD"),
});
export const createCommercialRecordSchema = z.object({
  type: z.enum(["purchase_order", "invoice", "payment_claim"]),
  costCodeId: z.string().optional().nullable(),
  reference: z.string().trim().min(1).max(48).regex(/^[a-zA-Z0-9._/-]+$/),
  counterparty: z.string().trim().min(2).max(160),
  description: z.string().max(1000).optional(),
  amount: positiveDecimalValue,
  currency: currencyCode.default("USD"),
  issueDate: z.coerce.date(),
  dueDate: z.coerce.date().optional().nullable(),
  notes: z.string().max(1000).optional(),
}).refine((value) => !value.dueDate || value.dueDate >= value.issueDate, { message: "Due date cannot be before issue date", path: ["dueDate"] });
export const updateCommercialStatusSchema = z.object({
  status: z.enum(["draft", "submitted", "approved", "rejected", "paid", "cancelled"]),
  notes: z.string().max(1000).optional(),
});
