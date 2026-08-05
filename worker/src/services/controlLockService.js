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

/**
 * For control changes triggered by code in THIS SAME process (e.g. the
 * agent loop handing off on an unsolved captcha) that are about to
 * immediately wait on the result: set state synchronously first, then
 * publish for any other observers. Using publishControlSignal + an
 * immediate waitForAgentControl here would race — publish() acks on one
 * Redis connection, but the local state only updates when the pmessage
 * arrives back on the separate subscriber connection, with no ordering
 * guarantee between the two. That race let waitForAgentControl resolve
 * before "human" had even been locally applied, causing the wait to be
 * skipped entirely on the very captcha handoff it exists to gate.
 */
export async function requestHumanControl(taskId) {
  state.set(taskId, "human");
  await publishControlSignal(taskId, "take_control");
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
