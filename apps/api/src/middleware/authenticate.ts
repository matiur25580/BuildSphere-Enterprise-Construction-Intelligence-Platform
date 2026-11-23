import type { Request, Response, NextFunction } from "express";
import type { JwtPayload } from "jsonwebtoken";
import { User } from "../modules/users/user.model.js";
import { Organization } from "../modules/organizations/organization.model.js";
import { Membership } from "../modules/organizations/membership.model.js";
import { verifyAccessToken } from "../modules/auth/auth.service.js";

declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; organizationId: string; role: string };
    }
  }
}

const authenticateRequest = (requireActiveOrganization: boolean) =>
  async (request: Request, response: Response, next: NextFunction) => {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      response.status(401).json({ success: false, message: "Authentication required" });
      return;
    }

    let payload: JwtPayload & { organizationId?: string; role?: string };
    try {
      const decoded = verifyAccessToken(authorization.slice(7));
      if (typeof decoded === "string") throw new Error("Invalid token payload");
      payload = decoded as JwtPayload & { organizationId?: string; role?: string };
      if (!payload.sub || !payload.organizationId || !payload.role) throw new Error("Invalid token claims");
    } catch {
      response.status(401).json({ success: false, message: "Access token is invalid or expired" });
      return;
    }

    try {
      const [activeUser, activeMembership, activeOrganization] = await Promise.all([
        User.exists({ _id: payload.sub, status: "active" }),
        Membership.exists({
          userId: payload.sub,
          organizationId: payload.organizationId,
          role: payload.role as "owner" | "admin" | "project_manager" | "member" | "viewer",
          status: "active",
        }),
        requireActiveOrganization
          ? Organization.exists({ _id: payload.organizationId, status: "active" })
          : Promise.resolve(true),
      ]);
      if (!activeUser || !activeMembership || !activeOrganization) {
        response.status(401).json({ success: false, message: "Account or organization access is no longer active" });
        return;
      }

      request.auth = { userId: payload.sub, organizationId: payload.organizationId, role: payload.role };
      next();
    } catch (error) {
      next(error);
    }
  };

export const authenticate = authenticateRequest(true);

// Only organization discovery/switching uses this middleware. It validates the
// user and membership but deliberately permits leaving a suspended tenant.
export const authenticateForOrganizationSelection = authenticateRequest(false);

export const requireRoles = (...roles: string[]) =>
  (request: Request, response: Response, next: NextFunction) => {
    if (!request.auth || !roles.includes(request.auth.role)) {
      response.status(403).json({ success: false, message: "You do not have permission to perform this action" });
      return;
    }
    next();
  };
