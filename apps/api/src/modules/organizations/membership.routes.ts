import { Router } from "express";
import { authenticate, requireRoles } from "../../middleware/authenticate.js";
import * as controller from "./membership.controller.js";

const router = Router();
router.use(authenticate, requireRoles("owner", "admin"));
router.get("/members", controller.listOrganizationMembers);
router.post("/members", controller.addOrganizationMember);
router.patch("/members/:memberId", controller.updateOrganizationMember);
export default router;
