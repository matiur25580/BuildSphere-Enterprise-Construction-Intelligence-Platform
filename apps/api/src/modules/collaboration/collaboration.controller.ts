import type { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../../common/async-handler.js";
import { HttpError } from "../../common/http-error.js";
import { Project } from "../projects/project.model.js";
import { Activity, Notification } from "./collaboration.models.js";
import { notificationReadSchema, paginationSchema } from "./collaboration.schemas.js";
import { notificationOwnerScope, projectActivityScope } from "./collaboration.service.js";

const auth = (request: Request) => {
  if (!request.auth) throw new HttpError(401, "Authentication required");
  return request.auth;
};

export const listActivity = asyncHandler(async (request: Request, response: Response) => {
  const context = auth(request);
  const projectId = String(request.params.projectId);
  if (!mongoose.isValidObjectId(projectId) || !await Project.exists({ _id: projectId, organizationId: context.organizationId })) throw new HttpError(404, "Project not found");
  const { limit, page } = paginationSchema.parse(request.query);
  const scope = projectActivityScope(context.organizationId, projectId);
  const [items, total] = await Promise.all([
    Activity.find(scope).populate("actorId", "name").sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Activity.countDocuments(scope),
  ]);
  response.json({ success: true, data: { items, page, limit, total, pages: Math.ceil(total / limit) } });
});

export const listNotifications = asyncHandler(async (request: Request, response: Response) => {
  const context = auth(request);
  const { limit, page } = paginationSchema.parse(request.query);
  const scope = notificationOwnerScope(context.organizationId, context.userId);
  const [items, total] = await Promise.all([
    Notification.find(scope).populate("activityId", "targetType targetId").sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Notification.countDocuments(scope),
  ]);
  response.json({ success: true, data: { items, page, limit, total, pages: Math.ceil(total / limit) } });
});

export const unreadCount = asyncHandler(async (request: Request, response: Response) => {
  const context = auth(request);
  const count = await Notification.countDocuments({ ...notificationOwnerScope(context.organizationId, context.userId), readAt: null });
  response.json({ success: true, data: { unread: count } });
});

export const markNotificationsRead = asyncHandler(async (request: Request, response: Response) => {
  const context = auth(request);
  const input = notificationReadSchema.parse(request.body);
  const result = await Notification.updateMany({
    ...notificationOwnerScope(context.organizationId, context.userId),
    _id: { $in: input.notificationIds },
    readAt: null,
  }, { $set: { readAt: new Date() } });
  response.json({ success: true, data: { modified: result.modifiedCount } });
});
