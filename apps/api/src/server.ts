import "dotenv/config";
import mongoose from "mongoose";
import app from "./app.js";
import { configureCollaborationTransactions, startCollaborationOutboxWorker } from "./modules/collaboration/collaboration.service.js";
import { startDocumentUploadCleanupWorker } from "./modules/delivery/document-upload-cleanup.service.js";

const port = Number(process.env.PORT) || 5000;
const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) throw new Error("MONGODB_URI must be configured");

const start = async () => {
  await mongoose.connect(mongoUri);
  const transactionsSupported = await configureCollaborationTransactions();
  console.info(`BuildSphere connected to MongoDB (collaboration transactions: ${transactionsSupported ? "enabled" : "non-atomic fallback"})`);
  const stopOutboxWorker = startCollaborationOutboxWorker();
  const stopDocumentUploadCleanupWorker = startDocumentUploadCleanupWorker();
  const server = app.listen(port, () => {
    console.info(`BuildSphere API listening on port ${port}`);
  });

  const shutdown = (signal: string) => {
    console.info(`${signal} received; shutting down gracefully.`);
    stopOutboxWorker();
    stopDocumentUploadCleanupWorker();
    server.close(() => {
      void mongoose.disconnect().finally(() => process.exit(0));
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

start().catch((error: unknown) => {
  console.error("Failed to start BuildSphere API:", error);
  process.exit(1);
});
