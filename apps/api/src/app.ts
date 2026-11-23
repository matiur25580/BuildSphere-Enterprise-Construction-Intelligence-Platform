import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import mongoose from "mongoose";
import { rateLimit } from "express-rate-limit";
import authRoutes from "./modules/auth/auth.routes.js";
import projectRoutes from "./modules/projects/project.routes.js";
import commercialRoutes from "./modules/commercial/commercial.routes.js";
import fieldRoutes from "./modules/field/field.routes.js";
import deliveryRoutes from "./modules/delivery/delivery.routes.js";
import intelligenceRoutes from "./modules/intelligence/intelligence.routes.js";
import { errorHandler } from "./middleware/error-handler.js";
import { createRequestId, isAllowedOrigin, parseAllowedOrigins, parseTrustProxy } from "./config/security.js";

const app = express();
const allowedOrigins = parseAllowedOrigins(process.env.CLIENT_URL);
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);

app.disable("x-powered-by");
if (trustProxy !== false) app.set("trust proxy", trustProxy);
app.use((request, response, next) => {
  const requestId = createRequestId();
  response.setHeader("X-Request-Id", requestId);
  response.locals.requestId = requestId;
  next();
});
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => callback(null, isAllowedOrigin(origin, allowedOrigins)),
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (request) => request.path === "/health" || request.path === "/ready",
  message: { success: false, message: "Too many requests; please try again later" },
});
app.use("/api", apiLimiter);

app.get("/api/v1/health", (_request, response) => {
  response.status(200).json({
    success: true,
    service: "BuildSphere API",
    version: "1.0.0",
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/v1/ready", (_request, response) => {
  const ready = mongoose.connection.readyState === 1;
  response.status(ready ? 200 : 503).json({
    success: ready,
    service: "BuildSphere API",
    status: ready ? "ready" : "not_ready",
    dependencies: { mongodb: ready ? "connected" : "disconnected" },
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/projects", projectRoutes);
app.use("/api/v1/projects/:projectId/commercial", commercialRoutes);
app.use("/api/v1/projects/:projectId/field", fieldRoutes);
app.use("/api/v1/projects/:projectId/delivery", deliveryRoutes);
app.use("/api/v1/projects/:projectId/intelligence", intelligenceRoutes);
app.use(errorHandler);

export default app;
