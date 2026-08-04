import { WebSocketServer } from "ws";
import { logger } from "../utils/logger.js";
import { publishControlSignal } from "../services/controlLockService.js";

// taskId -> { viewers: Set<ws>, controllerWs: ws|null, cdpSession, page }
const sessions = new Map();

export function createLiveServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const match = req.url.match(/^\/internal\/live\/([^/?]+)/);
    if (!match) {
      socket.destroy();
      return;
    }
    const taskId = match[1];
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(taskId, ws);
    });
  });

  return wss;
}

function handleConnection(taskId, ws) {
  const session = sessions.get(taskId);
  if (!session) {
    ws.send(JSON.stringify({ type: "error", message: "no active session for this task" }));
    ws.close();
    return;
  }

  session.viewers.add(ws);
  broadcastControlState(taskId);

  ws.on("message", (raw) => onViewerMessage(taskId, ws, raw));
  ws.on("close", () => {
    session.viewers.delete(ws);
    if (session.controllerWs === ws) {
      session.controllerWs = null;
      // Deliberately do NOT auto-resume the agent here: a human disconnecting
      // mid-takeover (flaky wifi, closed tab) should not silently hand control
      // back — they must reconnect and explicitly release/continue.
      broadcastControlState(taskId);
    }
  });
}

async function onViewerMessage(taskId, ws, raw) {
  const session = sessions.get(taskId);
  if (!session) return;

  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }

  switch (msg.type) {
    case "take_control": {
      if (!session.controllerWs || session.controllerWs === ws) {
        session.controllerWs = ws;
        await publishControlSignal(taskId, "take_control");
        broadcastControlState(taskId);
      }
      break;
    }
    case "release_control": {
      if (session.controllerWs === ws) {
        session.controllerWs = null;
      }
      await publishControlSignal(taskId, "release_control");
      broadcastControlState(taskId);
      break;
    }
    case "continue": {
      // "I solved the CAPTCHA / I'm done poking around — resume the agent."
      // Any connected viewer with the valid signed link can send this, not
      // just whoever happened to hold the controller lock.
      session.controllerWs = null;
      await publishControlSignal(taskId, "resume");
      broadcastControlState(taskId);
      break;
    }
    case "input": {
      if (session.controllerWs === ws) {
        await dispatchInput(session.cdpSession, msg.input);
      }
      break;
    }
    default:
      break;
  }
}

function broadcastControlState(taskId) {
  const session = sessions.get(taskId);
  if (!session) return;
  const payload = JSON.stringify({
    type: "control_state",
    hasController: !!session.controllerWs,
    viewers: session.viewers.size,
  });
  for (const viewer of session.viewers) {
    if (viewer.readyState === viewer.OPEN) viewer.send(payload);
  }
}

function broadcast(taskId, payload) {
  const session = sessions.get(taskId);
  if (!session) return;
  const raw = JSON.stringify(payload);
  for (const viewer of session.viewers) {
    if (viewer.readyState === viewer.OPEN) viewer.send(raw);
  }
}

async function dispatchInput(cdpSession, input) {
  try {
    if (input.kind === "mouse") {
      await cdpSession.send("Input.dispatchMouseEvent", {
        type: input.type, // 'mousePressed' | 'mouseReleased' | 'mouseMoved'
        x: input.x,
        y: input.y,
        button: input.button || "left",
        clickCount: input.clickCount || 1,
      });
    } else if (input.kind === "key") {
      await cdpSession.send("Input.dispatchKeyEvent", {
        type: input.type, // 'keyDown' | 'keyUp' | 'char'
        key: input.key,
        text: input.text,
      });
    } else if (input.kind === "wheel") {
      await cdpSession.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: input.x,
        y: input.y,
        deltaX: input.deltaX || 0,
        deltaY: input.deltaY || 0,
      });
    }
  } catch (err) {
    logger.warn("failed to dispatch remote input", { err: err.message });
  }
}

/** Called once a task's page/context exist — wires up CDP screencast + logs. */
export async function attachLiveSession(taskId, context, page) {
  const cdpSession = await context.newCDPSession(page);
  sessions.set(taskId, { viewers: new Set(), controllerWs: null, cdpSession, page });

  await cdpSession.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 1366, maxHeight: 768 });
  cdpSession.on("Page.screencastFrame", async ({ data, sessionId }) => {
    broadcast(taskId, { type: "frame", data });
    try {
      await cdpSession.send("Page.screencastFrameAck", { sessionId });
    } catch {
      // session may already be gone if the task just finished
    }
  });

  await cdpSession.send("Log.enable");
  cdpSession.on("Log.entryAdded", ({ entry }) => {
    broadcast(taskId, { type: "console", level: entry.level, text: entry.text, timestamp: entry.timestamp });
  });

  await cdpSession.send("Network.enable");
  cdpSession.on("Network.responseReceived", ({ response }) => {
    broadcast(taskId, { type: "network", url: response.url, status: response.status });
  });

  return async function detach() {
    try {
      await cdpSession.send("Page.stopScreencast");
    } catch {
      // ignore — page/context likely already closing
    }
    broadcast(taskId, { type: "session_ended" });
    sessions.delete(taskId);
  };
}

export function isHumanInControl(taskId) {
  return !!sessions.get(taskId)?.controllerWs;
}
