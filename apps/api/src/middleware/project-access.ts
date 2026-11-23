import type { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { HttpError } from "../common/http-error.js";
import { Project } from "../modules/projects/project.model.js";
import { ProjectMembership } from "../modules/projects/project-membership.model.js";

declare global {
  namespace Express {
    interface Request {
      projectRole?: "project_manager" | "contributor" | "viewer";
    }
  }
}

/**
 * Enforces tenant-scoped project existence and active project membership.
 * Organization owners/admins retain organization-wide access, but the project
 * must still belong to their authenticated organization.
 */
export const requireProjectAccess = () =>
  async (request: Request, _response: Response, next: NextFunction) => {
    try {
      if (!request.auth) throw new HttpError(401, "Authentication required");
      const projectId = String(request.params.projectId ?? "");
      if (!mongoose.isValidObjectId(projectId)) throw new HttpError(404, "Project not found");

      const scope = { _id: projectId, organizationId: request.auth.organizationId };
      const project = await Project.exists(scope);
      if (!project) throw new HttpError(404, "Project not found");

      if (["owner", "admin"].includes(request.auth.role)) {
        request.projectRole = undefined;
        next();
        return;
      }

      const membership = await ProjectMembership.findOne({
        organizationId: request.auth.organizationId,
        projectId,
        userId: request.auth.userId,
        status: "active",
      }).select("role").lean();

      if (!membership) throw new HttpError(403, "Active project membership is required");
      request.projectRole = membership.role as Request["projectRole"];
      next();
    } catch (error) {
      next(error);
    }
  };

/** Organization owners/admins or explicitly permitted project roles may proceed. */
export const requireProjectRoles = (...roles: Array<"project_manager" | "contributor" | "viewer">) =>
  (request: Request, _response: Response, next: NextFunction) => {
    if (!request.auth) {
      next(new HttpError(401, "Authentication required"));
      return;
    }
    if (["owner", "admin"].includes(request.auth.role) || (request.projectRole && roles.includes(request.projectRole))) {
      next();
      return;
    }
    next(new HttpError(403, "You do not have permission to perform this project action"));
  };
