import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import * as controller from "./collaboration.controller.js";

const router = Router({ mergeParams: true });
router.use(authenticate);
router.get("/activity", controller.listActivity);
export default router;
