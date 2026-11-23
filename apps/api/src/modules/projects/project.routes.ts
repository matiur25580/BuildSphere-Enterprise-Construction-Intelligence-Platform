import { Router } from "express";
import { authenticate, requireRoles } from "../../middleware/authenticate.js";
import * as controller from "./project.controller.js";

const router = Router();
router.use(authenticate);
router.get("/", controller.listProjects);
router.post("/", requireRoles("owner", "admin", "project_manager"), controller.createProject);
router.get("/:projectId", controller.getProject);
router.patch("/:projectId", requireRoles("owner", "admin", "project_manager"), controller.updateProject);
router.get("/:projectId/work-items", controller.listWorkItems);
router.post("/:projectId/work-items", requireRoles("owner", "admin", "project_manager"), controller.createWorkItem);
router.patch("/:projectId/work-items/:itemId", requireRoles("owner", "admin", "project_manager"), controller.updateWorkItem);

export default router;
