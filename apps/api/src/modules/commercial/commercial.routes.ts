import { Router } from "express";
import { authenticate, requireRoles } from "../../middleware/authenticate.js";
import * as controller from "./commercial.controller.js";

const router = Router({ mergeParams: true });
router.use(authenticate);
router.get("/summary", controller.getCommercialSummary);
router.get("/cost-codes", controller.listCostCodes);
router.post("/cost-codes", requireRoles("owner", "admin", "project_manager"), controller.createCostCode);
router.get("/records", controller.listRecords);
router.post("/records", requireRoles("owner", "admin", "project_manager"), controller.createRecord);
router.patch("/records/:recordId/status", requireRoles("owner", "admin", "project_manager"), controller.updateRecordStatus);
export default router;
