import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import authRoutes from "./modules/auth/auth.routes.js";
import projectRoutes from "./modules/projects/project.routes.js";
import commercialRoutes from "./modules/commercial/commercial.routes.js";
import fieldRoutes from "./modules/field/field.routes.js";
import deliveryRoutes from "./modules/delivery/delivery.routes.js";
import intelligenceRoutes from "./modules/intelligence/intelligence.routes.js";
import { errorHandler } from "./middleware/error-handler.js";

const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL ?? "http://localhost:5173",
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get("/api/v1/health", (_request, response) => {
  response.status(200).json({
    success: true,
    service: "BuildSphere API",
    version: "1.0.0",
    status: "healthy",
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
