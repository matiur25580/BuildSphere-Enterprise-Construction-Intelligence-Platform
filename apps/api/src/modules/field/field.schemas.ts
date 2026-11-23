import { z } from "zod";

export const createContractorSchema = z.object({
  companyName: z.string().trim().min(2).max(160),
  trade: z.string().trim().min(2).max(100),
  contactName: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  notes: z.string().max(1000).optional(),
});
export const updateContractorSchema = z.object({
  status: z.enum(["active", "suspended", "completed"]).optional(),
  contactName: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  notes: z.string().max(1000).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "Provide at least one field" });
const workforceSchema = z.object({
  trade: z.string().trim().min(2).max(100),
  contractorId: z.string().regex(/^[a-f\\d]{24}$/i).optional().nullable(),
  headcount: z.coerce.number().int().min(0).max(10000),
});
const equipmentSchema = z.object({
  name: z.string().trim().min(2).max(120),
  quantity: z.coerce.number().int().min(0).max(10000),
  hoursUsed: z.coerce.number().min(0).max(24),
  condition: z.enum(["operational", "maintenance", "out_of_service"]).default("operational"),
});
const photoSchema = z.object({
  url: z.string().url().max(2048).refine((value) => value.startsWith("https://"), "Photo evidence must use HTTPS"),
  caption: z.string().max(240).optional(),
  capturedAt: z.coerce.date().optional().nullable(),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
}).refine((value) => (value.latitude == null) === (value.longitude == null), { message: "Photo latitude and longitude must be supplied together" });
export const createDailyReportSchema = z.object({
  reportDate: z.coerce.date(),
  shift: z.enum(["day", "night"]).default("day"),
  weather: z.string().max(80).optional(),
  temperatureC: z.coerce.number().min(-60).max(65).optional().nullable(),
  workPerformed: z.string().trim().min(10).max(5000),
  progressPercent: z.coerce.number().min(0).max(100).default(0),
  workforce: z.array(workforceSchema).max(80).default([]),
  equipment: z.array(equipmentSchema).max(80).default([]),
  safetyObservations: z.string().max(3000).optional(),
  delaysAndIssues: z.string().max(3000).optional(),
  photos: z.array(photoSchema).max(30).default([]),
  siteLatitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  siteLongitude: z.coerce.number().min(-180).max(180).optional().nullable(),
}).refine((value) => (value.siteLatitude == null) === (value.siteLongitude == null), { message: "Site latitude and longitude must be supplied together" });
