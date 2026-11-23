import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { authenticate, authenticateForOrganizationSelection } from "../../middleware/authenticate.js";
import * as controller from "./auth.controller.js";

const router = Router();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, message: "Too many authentication attempts. Try again later." },
});

router.post("/register", authLimiter, controller.register);
router.post("/login", authLimiter, controller.login);
router.post("/refresh", authLimiter, controller.refresh);
router.post("/logout", controller.logout);
router.get("/me", authenticate, controller.me);
router.get("/organizations", authenticateForOrganizationSelection, controller.organizations);
router.post("/switch-organization", authenticateForOrganizationSelection, authLimiter, controller.switchOrganization);

export default router;
