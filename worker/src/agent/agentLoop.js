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
// Repeating the exact same action+args N times in a row is a stuck loop
// whether or not each attempt "succeeds" — Playwright doesn't error on
// re-navigating to a URL it's already on, so a model can loop on a
// no-op success just as badly as on a repeated failure. Failures get a
// tighter threshold since they're more clearly pathological; successes get
// one extra allowance since occasionally repeating a read/verify is normal.
const MAX_IDENTICAL_FAILURES = 3;
const MAX_IDENTICAL_SUCCESSES = 4;

// The prompt says "selectors MUST be copied verbatim from visible_elements"
// — but measured in production, even a stronger model called
// extract(selector="body") when the fact it needed (a non-currency number)
// wasn't surfaced anywhere in perceive()'s output. "body" always resolves
// in Playwright, so it "succeeded" every time and looped for 4 identical
// reads instead of failing fast on the very first invented selector. This
// enforces the rule in code: an unrecognized selector never reaches
// Playwright at all.
const SELECTOR_ACTIONS = new Set(["click", "type", "type_credential", "extract"]);

export async function runAgentLoop({ taskId, page, context, goal, model, credentials, maxSteps }) {
  const history = [];
  const credentialFieldsAvailable = Object.keys(credentials || {});
  const loopStreak = { lastSignature: null, count: 0 };

  for (let step = 1; step <= maxSteps; step++) {
    await handleHumanTakeoverGate(taskId, step);

    const observation = await perceiveWithRetry(page, taskId, step);

    if (await handleCaptchaIfPresent(page, taskId, step)) {
      continue; // re-perceive on the next loop iteration against the now-clear page
    }

    const decision = await reasonStep({ goal, observation, history, model, credentialFieldsAvailable, taskId, step });

    if (decision.name === "finish") {
      await appendAudit(taskId, step, "act", { action: "finish" });
      return { success: !!decision.args.success, summary: decision.args.summary, data: decision.args.data };
    }

    updateLoopStreak(loopStreak, decision, observation);

    const { ok, errMessage } = await executeAction({ page, decision, observation, credentials, history, taskId, step });

    const threshold = ok ? MAX_IDENTICAL_SUCCESSES : MAX_IDENTICAL_FAILURES;
    if (loopStreak.count >= threshold) {
      const errSuffix = errMessage ? ` — ${errMessage}` : "";
      return {
        success: false,
        summary: `stopped: repeated the exact same action (${decision.name}) ${loopStreak.count} times in a row with no progress${errSuffix}`,
      };
    }
  }

  return { success: false, summary: `stopped after reaching max_steps (${maxSteps}) without finishing` };
}

async function handleHumanTakeoverGate(taskId, step) {
  if (getControlState(taskId) !== "human") return;
  await updateStatus(taskId, { status: "waiting_input", wait_reason: "human_takeover", control_state: "human" });
  await appendAudit(taskId, step, "human_takeover", {});
  await waitForAgentControl(taskId);
  await updateStatus(taskId, { status: "running", wait_reason: null, control_state: "agent" });
  await appendAudit(taskId, step, "human_release", {});
}

async function perceiveWithRetry(page, taskId, step) {
  const perceiveStart = Date.now();
  let observation = await perceive(page);
  // A real page essentially never has zero interactive elements AND zero
  // text facts — measured in production, this combination showed up right
  // after a click that took 2.3s (a page transition): perceive() ran on the
  // very next loop iteration and caught a blank transitional state before
  // the SPA had rendered anything, so the model correctly refused to act on
  // "nothing here" and gave up. A single 1000ms retry fixed lighter pages
  // but a heavier one (a profile form with a country-dropdown dataset, 15
  // inputs) was confirmed via direct inspection to still be genuinely empty
  // at +1s and only render by +2s — so this escalates across a couple of
  // waits instead of one fixed one, still bounded so a truly broken/blank
  // page doesn't hang the step indefinitely.
  const RETRY_WAITS_MS = [1000, 1500];
  for (const waitMs of RETRY_WAITS_MS) {
    if (observation.elements.length > 0 || observation.textMatches.length > 0) break;
    await page.waitForTimeout(waitMs);
    observation = await perceive(page);
  }
  const perceiveMs = Date.now() - perceiveStart;
  logger.info("timing: perceive", { taskId, step, ms: perceiveMs, elements: observation.elements.length, textMatches: observation.textMatches.length });
  await appendAudit(taskId, step, "perceive", { url: observation.url, title: observation.title, perceiveMs });
  return observation;
}

/** Returns true if a captcha was handled this step (caller should skip reasoning and re-perceive). */
async function handleCaptchaIfPresent(page, taskId, step) {
  const captchaStart = Date.now();
  const captcha = await detectCaptcha(page);
  logger.info("timing: detectCaptcha", { taskId, step, ms: Date.now() - captchaStart });
  if (!captcha.detected) return false;

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
  return true;
}

async function reasonStep({ goal, observation, history, model, credentialFieldsAvailable, taskId, step }) {
  const reasonStart = Date.now();
  const decision = await reason({ goal, observation, history, model, credentialFieldsAvailable });
  const reasonMs = Date.now() - reasonStart;
  logger.info("timing: reason", { taskId, step, ms: reasonMs, action: decision.name });
  await appendAudit(taskId, step, "reason", { action: decision.name, args: redactArgs(decision), reasonMs });
  return decision;
}

// The "don't repeat yourself" rules live in the prompt, but a prompt is a
// nudge, not a guarantee — measured in production, a cheap model repeated
// the exact same failing action 50+ times in a row, and separately looped
// navigating to the identical URL a dozen times (which Playwright doesn't
// error on, so a failure-only check never caught it). This mechanical
// backstop doesn't depend on the model noticing anything, in either case.
function updateLoopStreak(loopStreak, decision, observation) {
  const signature = `${decision.name}|${JSON.stringify(stableIdentity(decision, observation))}`;
  loopStreak.count = signature === loopStreak.lastSignature ? loopStreak.count + 1 : 1;
  loopStreak.lastSignature = signature;
}

async function executeAction({ page, decision, observation, credentials, history, taskId, step }) {
  const actStart = Date.now();
  const selector = decision.args?.selector;

  if (SELECTOR_ACTIONS.has(decision.name) && selector && !observation.knownSelectors.has(selector)) {
    const errMessage = `selector "${selector}" was not in this step's visible_elements/page_text_matches — invented selectors are rejected before touching the page`;
    history.push({ step, action: decision.name, args: redactArgs(decision), error: errMessage });
    await appendAudit(taskId, step, "act", { action: decision.name, ok: false, error: errMessage, actMs: 0 });
    logger.info("timing: act", { taskId, step, ms: 0, action: decision.name, ok: false });
    return { ok: false, errMessage };
  }

  try {
    const result = await act(page, decision, { credentials });
    history.push({ step, action: decision.name, args: redactArgs(decision), result: summarizeResult(result) });
    await appendAudit(taskId, step, "act", { action: decision.name, ok: true, actMs: Date.now() - actStart });
    logger.info("timing: act", { taskId, step, ms: Date.now() - actStart, action: decision.name, ok: true });
    return { ok: true, errMessage: null };
  } catch (err) {
    history.push({ step, action: decision.name, args: redactArgs(decision), error: err.message });
    await appendAudit(taskId, step, "act", { action: decision.name, ok: false, error: err.message, actMs: Date.now() - actStart });
    logger.info("timing: act", { taskId, step, ms: Date.now() - actStart, action: decision.name, ok: false });
    return { ok: false, errMessage: err.message };
  }
}

function redactArgs(decision) {
  if (decision.name === "type_credential") return { ...decision.args };
  if (decision.name === "type") return { selector: decision.args.selector, text: "***" };
  return decision.args;
}

// [data-fc-idx="N"] is a positional tag reassigned from scratch on every
// single perceive() call — "index 2" on the login form and "index 2" on the
// dashboard after it are almost certainly two different real elements that
// just happened to land on the same number. Comparing those selector
// strings across steps produced a false "stuck loop" detection that killed
// a task which may have genuinely been exploring different elements.
// #id / [name=] / [data-testid=] selectors ARE durable across steps (they
// name a real DOM attribute, not a position), so those are still compared
// directly. For positional tags, compare the element's visible label
// instead — a real repeat (clicking "Sign In" three times) still shares a
// label; three different menu items don't, even if they coincidentally
// shared an index.
function stableIdentity(decision, observation) {
  const args = redactArgs(decision);
  if (!args.selector || !/^\[data-fc-idx="\d+"\]$/.test(args.selector)) {
    return { url: observation.url, ...args };
  }
  const match = [...observation.elements, ...observation.textMatches].find((e) => e.selector === args.selector);
  const label = match?.text ?? args.selector;
  return { url: observation.url, ...args, selector: undefined, label };
}

function summarizeResult(result) {
  if (result?.extracted) return { extracted: result.extracted.slice(0, 200) };
  return { ok: result?.ok };
}
