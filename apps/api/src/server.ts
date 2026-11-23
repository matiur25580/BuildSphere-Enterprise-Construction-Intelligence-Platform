import "dotenv/config";
import app from "./app.js";

const port = Number(process.env.PORT) || 5000;

const server = app.listen(port, () => {
  console.info(`BuildSphere API listening on port ${port}`);
});

const shutdown = (signal: string) => {
  console.info(`${signal} received; shutting down gracefully.`);
  server.close((error) => {
    if (error) {
      console.error("Error while closing HTTP server:", error);
      process.exitCode = 1;
      return;
    }
    process.exit(0);
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
