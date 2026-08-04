import { redis } from "./redisClient.js";
import { runTask } from "../controllers/sessionController.js";
import { logger } from "../utils/logger.js";
import { env } from "../config/env.js";

const STREAM = "tasks:queue";
const GROUP = "workers";
const CONSUMER = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

async function ensureGroup() {
  try {
    await redis.xgroup("CREATE", STREAM, GROUP, "0", "MKSTREAM");
  } catch (err) {
    if (!String(err.message).includes("BUSYGROUP")) throw err;
  }
}

export async function startQueueConsumer() {
  await ensureGroup();
  logger.info("queue consumer started", { consumer: CONSUMER, concurrency: env.concurrency });

  let inFlight = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (inFlight >= env.concurrency) {
      await new Promise((r) => setTimeout(r, 250));
      continue;
    }

    const response = await redis.xreadgroup(
      "GROUP",
      GROUP,
      CONSUMER,
      "COUNT",
      1,
      "BLOCK",
      5000,
      "STREAMS",
      STREAM,
      ">"
    );
    if (!response) continue;

    for (const [, messages] of response) {
      for (const [messageId, fields] of messages) {
        const taskId = fields[fields.indexOf("task_id") + 1];
        inFlight++;
        runTask(taskId)
          .catch((err) => logger.error("unhandled task error", { taskId, err: err.message }))
          .finally(async () => {
            inFlight--;
            await redis.xack(STREAM, GROUP, messageId);
          });
      }
    }
  }
}
