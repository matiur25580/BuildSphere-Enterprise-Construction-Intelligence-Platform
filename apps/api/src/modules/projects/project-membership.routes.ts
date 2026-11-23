import { Router } from "express";
import { authenticate, requireRoles } from "../../middleware/authenticate.js";
import * as controller from "./project-membership.controller.js";

const router = Router({ mergeParams: true });
router.use(authenticate);
router.get("/", controller.listProjectMembers);
router.post("/", requireRoles("owner", "admin", "project_manager"), controller.addProjectMember);
router.patch("/:memberId", requireRoles("owner", "admin", "project_manager"), controller.updateProjectMember);
export default router;
