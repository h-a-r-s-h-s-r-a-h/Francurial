import { launchTaskBrowser, closeTaskBrowser } from "../services/browserService.js";
import { attachLiveSession } from "../ws/liveServer.js";
import { runAgentLoop } from "../agent/agentLoop.js";
import { claimTask, updateStatus } from "../services/gatewayClient.js";
import { getSelfAddress } from "../utils/selfAddress.js";
import { clearTask } from "../services/controlLockService.js";
import { logger } from "../utils/logger.js";

export async function runTask(taskId) {
  const selfAddr = getSelfAddress();
  const task = await claimTask(taskId, selfAddr);

  let browserHandle;
  let detachLive;
  try {
    browserHandle = await launchTaskBrowser({ proxy: task.proxy });
    const { context, page } = browserHandle;

    detachLive = await attachLiveSession(taskId, context, page);

    await page.goto(task.url, { waitUntil: "domcontentloaded", timeout: 30_000 });

    const outcome = await runAgentLoop({
      taskId,
      page,
      context,
      goal: task.instruction,
      model: task.model,
      credentials: task.credentials,
      maxSteps: task.max_steps,
    });

    await updateStatus(taskId, {
      status: outcome.success ? "completed" : "failed",
      result: { summary: outcome.summary, data: outcome.data },
      error: outcome.success ? null : outcome.summary,
    });
  } catch (err) {
    logger.error("task run failed", { taskId, err: err.message });
    await updateStatus(taskId, { status: "failed", error: err.message }).catch(() => {});
  } finally {
    if (detachLive) await detachLive().catch(() => {});
    if (browserHandle) await closeTaskBrowser(browserHandle);
    clearTask(taskId);
  }
}
