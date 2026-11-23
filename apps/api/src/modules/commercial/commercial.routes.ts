import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requireProjectAccess, requireProjectRoles } from "../../middleware/project-access.js";
import * as controller from "./commercial.controller.js";

const router = Router({ mergeParams: true });
router.use(authenticate, requireProjectAccess());
router.get("/summary", controller.getCommercialSummary);
router.get("/cost-codes", controller.listCostCodes);
router.post("/cost-codes", requireProjectRoles("project_manager"), controller.createCostCode);
router.get("/records", controller.listRecords);
router.post("/records", requireProjectRoles("project_manager"), controller.createRecord);
router.patch("/records/:recordId/status", requireProjectRoles("project_manager"), controller.updateRecordStatus);
export default router;
