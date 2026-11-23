import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import * as controller from "./intelligence.controller.js";
const router = Router({ mergeParams: true });
router.use(authenticate);
router.get("/insights", controller.getProjectInsights);
router.post("/ask", controller.askProjectEvidence);
export default router;
