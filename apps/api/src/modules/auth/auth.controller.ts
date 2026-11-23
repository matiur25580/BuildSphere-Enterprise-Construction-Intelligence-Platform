import type { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler.js";
import { HttpError } from "../../common/http-error.js";
import { loginSchema, registerSchema, switchOrganizationSchema } from "./auth.schemas.js";
import * as authService from "./auth.service.js";

const isProduction = process.env.NODE_ENV === "production";
const refreshCookieName = "buildsphere_refresh";

const cookieOptions = () => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: "strict" as const,
  path: "/api/v1/auth",
  maxAge: 30 * 24 * 60 * 60 * 1000,
});

const metadata = (request: Request) => ({
  userAgent: request.get("user-agent") ?? undefined,
  ipAddress: request.ip,
});

const setRefreshCookie = (response: Response, token: string) =>
  response.cookie(refreshCookieName, token, cookieOptions());

const clearRefreshCookie = (response: Response) =>
  response.clearCookie(refreshCookieName, { ...cookieOptions(), maxAge: undefined });

export const register = asyncHandler(async (request, response) => {
  const parsed = registerSchema.safeParse(request.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid registration data");
  const result = await authService.register(parsed.data, metadata(request));
  setRefreshCookie(response, result.refreshToken);
  response.status(201).json({
    success: true,
    data: { accessToken: result.accessToken, user: result.user, organization: result.organization },
  });
});

export const login = asyncHandler(async (request, response) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid login data");
  const result = await authService.login(parsed.data, metadata(request));
  setRefreshCookie(response, result.refreshToken);
  response.status(200).json({
    success: true,
    data: { accessToken: result.accessToken, user: result.user, organization: result.organization },
  });
});

export const refresh = asyncHandler(async (request, response) => {
  const token = request.cookies?.[refreshCookieName] as string | undefined;
  if (!token) throw new HttpError(401, "Refresh session is missing");
  const result = await authService.refresh(token, metadata(request));
  setRefreshCookie(response, result.refreshToken);
  response.status(200).json({ success: true, data: { accessToken: result.accessToken } });
});

export const switchOrganization = asyncHandler(async (request, response) => {
  if (!request.auth) throw new HttpError(401, "Authentication required");
  const parsed = switchOrganizationSchema.safeParse(request.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid organization selection");
  const token = request.cookies?.[refreshCookieName] as string | undefined;
  if (!token) throw new HttpError(401, "Refresh session is missing");
  const result = await authService.switchOrganization(
    request.auth.userId,
    parsed.data.organizationId,
    token,
    metadata(request),
  );
  setRefreshCookie(response, result.refreshToken);
  response.status(200).json({
    success: true,
    data: { accessToken: result.accessToken, organization: result.organization },
  });
});

export const organizations = asyncHandler(async (request, response) => {
  if (!request.auth) throw new HttpError(401, "Authentication required");
  const data = await authService.listUserOrganizations(request.auth.userId);
  response.status(200).json({ success: true, data });
});

export const logout = asyncHandler(async (request, response) => {
  const token = request.cookies?.[refreshCookieName] as string | undefined;
  await authService.logout(token);
  clearRefreshCookie(response);
  response.status(200).json({ success: true, message: "Signed out successfully" });
});

export const me = asyncHandler(async (request, response) => {
  if (!request.auth) throw new HttpError(401, "Authentication required");
  const data = await authService.getCurrentUser(request.auth.userId, request.auth.organizationId);
  response.status(200).json({ success: true, data });
});
