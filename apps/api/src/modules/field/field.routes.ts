import { Router } from "express";
import { authenticate, requireRoles } from "../../middleware/authenticate.js";
import * as controller from "./field.controller.js";

const router = Router({ mergeParams: true });
router.use(authenticate);
router.get("/summary", controller.getFieldSummary);
router.get("/contractors", controller.listContractors);
router.post("/contractors", requireRoles("owner", "admin", "project_manager"), controller.createContractor);
router.patch("/contractors/:contractorId", requireRoles("owner", "admin", "project_manager"), controller.updateContractor);
router.get("/daily-reports", controller.listDailyReports);
router.post("/daily-reports", requireRoles("owner", "admin", "project_manager"), controller.createDailyReport);
export default router;
