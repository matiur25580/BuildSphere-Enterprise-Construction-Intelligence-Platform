import { Router } from "express";
import { authenticate, requireRoles } from "../../middleware/authenticate.js";
import { requireProjectAccess, requireProjectRoles } from "../../middleware/project-access.js";
import * as controller from "./project.controller.js";
import projectMembershipRoutes from "./project-membership.routes.js";

const router = Router();
router.use(authenticate);
router.use("/:projectId/members", projectMembershipRoutes);
router.get("/", controller.listProjects);
router.post("/", requireRoles("owner", "admin", "project_manager"), controller.createProject);
router.get("/:projectId", requireProjectAccess(), controller.getProject);
router.patch("/:projectId", requireProjectAccess(), requireProjectRoles("project_manager"), controller.updateProject);
router.get("/:projectId/work-items", requireProjectAccess(), controller.listWorkItems);
router.post("/:projectId/work-items", requireProjectAccess(), requireProjectRoles("project_manager"), controller.createWorkItem);
router.patch("/:projectId/work-items/:itemId", requireProjectAccess(), requireProjectRoles("project_manager"), controller.updateWorkItem);

export default router;
