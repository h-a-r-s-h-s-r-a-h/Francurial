import { EventEmitter } from "events";
import { redis, redisSub } from "./redisClient.js";
import { logger } from "../utils/logger.js";

// Single source of truth for "who's driving": every control change (human
// takeover from the live view, a REST /continue call, an agent-detected
// captcha handoff) is published to Redis so the agent loop and the live WS
// server — even if they end up on different processes — agree on state.
const bus = new EventEmitter();
const state = new Map(); // taskId -> 'agent' | 'human'

await redisSub.psubscribe("control:*");
redisSub.on("pmessage", (_pattern, channel, message) => {
  const taskId = channel.slice("control:".length);
  let signal;
  try {
    ({ signal } = JSON.parse(message));
  } catch {
    return;
  }

  if (signal === "take_control") {
    state.set(taskId, "human");
  } else if (signal === "release_control" || signal === "resume") {
    state.set(taskId, "agent");
  }
  logger.info("control state changed", { taskId, signal, newState: state.get(taskId) });
  bus.emit(`change:${taskId}`, state.get(taskId));
});

export function getControlState(taskId) {
  return state.get(taskId) || "agent";
}

export async function publishControlSignal(taskId, signal) {
  await redis.publish(`control:${taskId}`, JSON.stringify({ signal }));
}

/** Resolves once the task's control state flips (back) to 'agent'. */
export function waitForAgentControl(taskId) {
  if (getControlState(taskId) === "agent") return Promise.resolve();
  return new Promise((resolve) => {
    const handler = (newState) => {
      if (newState === "agent") {
        bus.off(`change:${taskId}`, handler);
        resolve();
      }
    };
    bus.on(`change:${taskId}`, handler);
  });
}

export function clearTask(taskId) {
  state.delete(taskId);
}
