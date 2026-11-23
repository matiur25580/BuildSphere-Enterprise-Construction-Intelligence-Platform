import { Router } from "express";
import { authenticate, requireRoles } from "../../middleware/authenticate.js";
import * as controller from "./bim.controller.js";

const router = Router({ mergeParams: true });
router.use(authenticate);
router.get("/models", controller.listBimModels);
router.post("/models", requireRoles("owner", "admin", "project_manager"), controller.registerBimModel);
router.get("/issues", controller.listBimIssues);
router.post("/issues", requireRoles("owner", "admin", "project_manager"), controller.createBimIssue);
router.patch("/issues/:issueId/status", requireRoles("owner", "admin", "project_manager"), controller.updateBimIssue);
export default router;
