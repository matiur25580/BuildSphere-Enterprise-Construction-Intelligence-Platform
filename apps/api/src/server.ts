import "dotenv/config";
import mongoose from "mongoose";
import app from "./app.js";
import { configureCollaborationTransactions, startCollaborationOutboxWorker } from "./modules/collaboration/collaboration.service.js";
import { assertDocumentStorageConfigured } from "./modules/delivery/document-storage.js";

const port = Number(process.env.PORT) || 5000;
const mongoUri = process.env.MONGODB_URI;
const shutdownTimeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10_000;

if (!mongoUri) throw new Error("MONGODB_URI must be configured");

const start = async () => {
  assertDocumentStorageConfigured();
  await mongoose.connect(mongoUri);
  const transactionsSupported = await configureCollaborationTransactions();
  console.info(`BuildSphere connected to MongoDB (collaboration transactions: ${transactionsSupported ? "enabled" : "non-atomic fallback"})`);
  const stopOutboxWorker = startCollaborationOutboxWorker();
  const server = app.listen(port, () => {
    console.info(`BuildSphere API listening on port ${port}`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`${signal} received; shutting down gracefully.`);
    stopOutboxWorker();

    const forceShutdown = setTimeout(() => {
      console.error(`Graceful shutdown exceeded ${shutdownTimeoutMs}ms; forcing process exit.`);
      server.closeAllConnections();
      process.exit(1);
    }, shutdownTimeoutMs);
    forceShutdown.unref();

    server.close((error) => {
      if (error) {
        clearTimeout(forceShutdown);
        console.error("HTTP server failed to close cleanly:", error);
        process.exit(1);
        return;
      }
      void mongoose.disconnect().then(() => {
        clearTimeout(forceShutdown);
        process.exit(0);
      }).catch((disconnectError: unknown) => {
        clearTimeout(forceShutdown);
        console.error("MongoDB failed to disconnect cleanly:", disconnectError);
        process.exit(1);
      });
    });
    server.closeIdleConnections();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

start().catch((error: unknown) => {
  console.error("Failed to start BuildSphere API:", error);
  process.exit(1);
});
