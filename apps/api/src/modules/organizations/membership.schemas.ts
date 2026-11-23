import { z } from "zod";

const organizationRole = z.enum(["owner", "admin", "project_manager", "member", "viewer"]);
export const addOrganizationMemberSchema = z.object({
  email: z.string().email().max(254).transform((value) => value.toLowerCase().trim()),
  role: organizationRole.default("member"),
});
export const updateOrganizationMemberSchema = z.object({
  role: organizationRole.optional(),
  status: z.enum(["active", "suspended"]).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");
