import { env } from "../config/env.js";
import { perceive } from "./perceive.js";
import { reason } from "./reason.js";
import { act } from "./act.js";
import { detectCaptcha, attemptAutoSolve } from "../services/captchaService.js";
import { getControlState, waitForAgentControl, requestHumanControl } from "../services/controlLockService.js";
import { appendAudit, updateStatus } from "../services/gatewayClient.js";
import { logger } from "../utils/logger.js";

/**
 * perceive -> reason -> act, with two ways execution can pause and resume
 * from wherever it left off:
 *   1. A human takes control from the live view (or a captcha stalls the
 *      agent) -> loop blocks on waitForAgentControl() -> on release, the
 *      NEXT iteration re-perceives current state and keeps going toward the
 *      same goal. No stored "next planned step" to resume — the fresh
 *      perceive() each turn is what makes resume-from-anywhere possible.
 *   2. Captcha: agent tries attemptAutoSolve() first; only on failure does
 *      it hand off to a human and pause the same way.
 */
export async function runAgentLoop({ taskId, page, context, goal, model, credentials, maxSteps }) {
  const history = [];
  const credentialFieldsAvailable = Object.keys(credentials || {});

  for (let step = 1; step <= maxSteps; step++) {
    if (getControlState(taskId) === "human") {
      await updateStatus(taskId, { status: "waiting_input", wait_reason: "human_takeover", control_state: "human" });
      await appendAudit(taskId, step, "human_takeover", {});
      await waitForAgentControl(taskId);
      await updateStatus(taskId, { status: "running", wait_reason: null, control_state: "agent" });
      await appendAudit(taskId, step, "human_release", {});
    }

    const observation = await perceive(page);
    await appendAudit(taskId, step, "perceive", { url: observation.url, title: observation.title });

    const captcha = await detectCaptcha(page);
    if (captcha.detected) {
      await appendAudit(taskId, step, "captcha_detected", { selector: captcha.selector });

      let solved = false;
      for (let attempt = 1; attempt <= env.captchaSolveAttempts && !solved; attempt++) {
        const result = await attemptAutoSolve(page, captcha);
        solved = result.solved;
      }

      if (solved) {
        await appendAudit(taskId, step, "captcha_solved", { by: "agent" });
      } else {
        await appendAudit(taskId, step, "captcha_handoff", {});
        await updateStatus(taskId, { status: "waiting_input", wait_reason: "captcha", control_state: "human" });
        await requestHumanControl(taskId); // sets local state before waiting — see controlLockService for why
        await waitForAgentControl(taskId);
        await appendAudit(taskId, step, "captcha_solved", { by: "human" });
        await updateStatus(taskId, { status: "running", wait_reason: null, control_state: "agent" });
      }
      continue; // re-perceive on the next loop iteration against the now-clear page
    }

    const decision = await reason({ goal, observation, history, model, credentialFieldsAvailable });
    await appendAudit(taskId, step, "reason", { action: decision.name, args: redactArgs(decision) });

    if (decision.name === "finish") {
      await appendAudit(taskId, step, "act", { action: "finish" });
      return { success: !!decision.args.success, summary: decision.args.summary, data: decision.args.data };
    }

    try {
      const result = await act(page, decision, { credentials });
      history.push({ step, action: decision.name, args: redactArgs(decision), result: summarizeResult(result) });
      await appendAudit(taskId, step, "act", { action: decision.name, ok: true });
    } catch (err) {
      logger.warn("action failed", { taskId, step, action: decision.name, err: err.message });
      history.push({ step, action: decision.name, args: redactArgs(decision), error: err.message });
      await appendAudit(taskId, step, "act", { action: decision.name, ok: false, error: err.message });
    }
  }

  return { success: false, summary: `stopped after reaching max_steps (${maxSteps}) without finishing` };
}

function redactArgs(decision) {
  if (decision.name === "type_credential") return { ...decision.args };
  if (decision.name === "type") return { selector: decision.args.selector, text: "***" };
  return decision.args;
}

function summarizeResult(result) {
  if (result?.extracted) return { extracted: result.extracted.slice(0, 200) };
  return { ok: result?.ok };
}
