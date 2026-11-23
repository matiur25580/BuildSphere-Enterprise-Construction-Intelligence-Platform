import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requireProjectAccess } from "../../middleware/project-access.js";
import * as controller from "./intelligence.controller.js";
const router = Router({ mergeParams: true });
router.use(authenticate, requireProjectAccess());
router.get("/insights", controller.getProjectInsights);
router.post("/ask", controller.askProjectEvidence);
export default router;
