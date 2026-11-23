import type { ErrorRequestHandler } from "express";
import { HttpError } from "../common/http-error.js";

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof HttpError) {
    response.status(error.statusCode).json({ success: false, message: error.message });
    return;
  }
  if (error && typeof error === "object" && "name" in error && error.name === "ValidationError") {
    response.status(400).json({ success: false, message: "Request validation failed" });
    return;
  }
  console.error("Unhandled API error:", error);
  response.status(500).json({ success: false, message: "Internal server error" });
};
