import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requireProjectAccess, requireProjectRoles } from "../../middleware/project-access.js";
import * as controller from "./collaboration.controller.js";

const router = Router({ mergeParams: true });
router.use(authenticate, requireProjectAccess());
router.get("/activity", controller.listActivity);
router.get("/outbox/failed", requireProjectRoles("project_manager"), controller.listFailedOutboxEvents);
router.post("/outbox/:eventId/replay", requireProjectRoles("project_manager"), controller.replayFailedOutboxEvent);
export default router;
