import { chromium } from "playwright";

/**
 * One browser + one context per task, proxy held for the task's full
 * lifetime ("sticky session") — never rotated mid-task. Chromium only for
 * now: CDP screencast (live view) and CDP input injection both depend on it.
 */
export async function launchTaskBrowser({ proxy }) {
  const browser = await chromium.launch({
    headless: true,
    proxy: {
      server: `http://${proxy.host}:${proxy.port}`,
      username: proxy.username,
      password: proxy.password,
    },
    // --disable-dev-shm-usage matters in Kubernetes: the default /dev/shm is
    // a tiny 64MB tmpfs there and Chromium reliably crashes without this.
    args: ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
  });

  const page = await context.newPage();
  return { browser, context, page };
}

export async function closeTaskBrowser({ browser }) {
  await browser.close().catch(() => {});
}
