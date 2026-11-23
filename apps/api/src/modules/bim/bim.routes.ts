import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import * as controller from "./bim.controller.js";

const router = Router({ mergeParams: true });
router.use(authenticate);
router.get("/models", controller.listBimModels);
router.post("/models", controller.registerBimModel);
router.get("/issues", controller.listBimIssues);
router.post("/issues", controller.createBimIssue);
router.patch("/issues/:issueId/status", controller.updateBimIssue);
export default router;
