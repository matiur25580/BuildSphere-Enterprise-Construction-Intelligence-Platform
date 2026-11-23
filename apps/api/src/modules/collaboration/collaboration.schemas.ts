import { z } from "zod";

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export const notificationReadSchema = z.object({
  notificationIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(50),
});
