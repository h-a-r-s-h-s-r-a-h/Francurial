import http from "http";
import express from "express";
import { env } from "./config/env.js";
import { createLiveServer } from "./ws/liveServer.js";
import { startQueueConsumer } from "./services/queueConsumer.js";
import { logger } from "./utils/logger.js";

const app = express();
app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

const httpServer = http.createServer(app);
createLiveServer(httpServer); // handles the /internal/live/:taskId WS upgrade

httpServer.listen(env.workerInternalPort, () => {
  logger.info("worker internal server listening", { port: env.workerInternalPort });
});

startQueueConsumer().catch((err) => {
  logger.error("queue consumer crashed", { err: err.message });
  process.exit(1);
});
