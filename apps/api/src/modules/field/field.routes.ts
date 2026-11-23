import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requireProjectAccess, requireProjectRoles } from "../../middleware/project-access.js";
import * as controller from "./field.controller.js";

const router = Router({ mergeParams: true });
router.use(authenticate, requireProjectAccess());
router.get("/summary", controller.getFieldSummary);
router.get("/contractors", controller.listContractors);
router.post("/contractors", requireProjectRoles("project_manager"), controller.createContractor);
router.patch("/contractors/:contractorId", requireProjectRoles("project_manager"), controller.updateContractor);
router.get("/daily-reports", controller.listDailyReports);
router.post("/daily-reports", requireProjectRoles("project_manager"), controller.createDailyReport);
export default router;
