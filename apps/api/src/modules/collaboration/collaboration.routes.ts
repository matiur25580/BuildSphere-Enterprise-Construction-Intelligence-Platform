import { Router } from "express";
import { authenticate, requireRoles } from "../../middleware/authenticate.js";
import * as controller from "./collaboration.controller.js";

const router = Router({ mergeParams: true });
router.use(authenticate);
router.get("/activity", controller.listActivity);
router.get("/outbox/failed", requireRoles("owner", "admin", "project_manager"), controller.listFailedOutboxEvents);
router.post("/outbox/:eventId/replay", requireRoles("owner", "admin", "project_manager"), controller.replayFailedOutboxEvent);
export default router;
