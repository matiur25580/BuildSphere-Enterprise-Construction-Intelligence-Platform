import { z } from "zod";

export const addProjectMemberSchema = z.object({
  userId: z.string().regex(/^[a-f\d]{24}$/i),
  role: z.enum(["project_manager", "contributor", "viewer"]).default("contributor"),
});
export const updateProjectMemberSchema = z.object({
  role: z.enum(["project_manager", "contributor", "viewer"]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");
