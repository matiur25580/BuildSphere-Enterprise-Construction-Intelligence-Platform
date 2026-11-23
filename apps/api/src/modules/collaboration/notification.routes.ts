import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import * as controller from "./collaboration.controller.js";

const router = Router();
router.use(authenticate);
router.get("/", controller.listNotifications);
router.get("/unread-count", controller.unreadCount);
router.patch("/read", controller.markNotificationsRead);
export default router;
