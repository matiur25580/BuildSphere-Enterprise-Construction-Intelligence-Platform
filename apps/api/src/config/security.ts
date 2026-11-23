import { randomUUID } from "node:crypto";

export const parseAllowedOrigins = (value = "http://localhost:5173"): string[] =>
  value.split(",").map((origin) => origin.trim()).filter(Boolean);

export const isAllowedOrigin = (origin: string | undefined, allowedOrigins: string[]): boolean =>
  !origin || allowedOrigins.includes(origin);

export const parseTrustProxy = (value: string | undefined): boolean | number | string => {
  if (!value || value === "false") return false;
  if (value === "true") return true;
  const hops = Number(value);
  if (Number.isInteger(hops) && hops >= 0) return hops;
  throw new Error("TRUST_PROXY must be true, false, or a non-negative integer");
};

export const isApiRateLimitExemptPath = (path: string): boolean =>
  path === "/v1/health" || path === "/v1/ready";

export const createRequestId = (): string => randomUUID();
