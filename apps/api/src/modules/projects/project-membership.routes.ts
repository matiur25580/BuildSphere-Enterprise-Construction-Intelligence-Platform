import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requireProjectAccess, requireProjectRoles } from "../../middleware/project-access.js";
import * as controller from "./project-membership.controller.js";

const router = Router({ mergeParams: true });
router.use(authenticate, requireProjectAccess());
router.get("/", controller.listProjectMembers);
router.get("/eligible", requireProjectRoles("project_manager"), controller.listEligibleProjectMembers);
router.post("/", requireProjectRoles("project_manager"), controller.addProjectMember);
router.patch("/:memberId", requireProjectRoles("project_manager"), controller.updateProjectMember);
export default router;
