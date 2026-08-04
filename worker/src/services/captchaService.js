const CAPTCHA_MARKERS = [
  'iframe[src*="captcha" i]',
  'iframe[title*="captcha" i]',
  ".g-recaptcha",
  "#g-recaptcha",
  ".h-captcha",
  ".cf-turnstile",
  '[class*="captcha" i]',
];

export async function detectCaptcha(page) {
  for (const selector of CAPTCHA_MARKERS) {
    const found = await page.locator(selector).first().isVisible().catch(() => false);
    if (found) return { detected: true, selector };
  }
  return { detected: false };
}

/**
 * Best-effort only: clicks a simple "I'm not a robot" style checkbox when
 * present. Real image/audio-challenge solving needs a paid 3rd-party solver
 * (2Captcha/Anti-Captcha/etc) — wire one in here behind a config flag when
 * you have a contract with one; until then this intentionally gives up fast
 * so the human handoff kicks in rather than the agent looping forever.
 */
export async function attemptAutoSolve(page, { selector }) {
  try {
    const frameLocator = page.frameLocator(selector);
    const checkbox = frameLocator.locator('#recaptcha-anchor, [role="checkbox"]').first();
    if (await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      await checkbox.click({ timeout: 2000 });
      await page.waitForTimeout(1500);
    }
  } catch {
    // fall through — caller re-checks detectCaptcha() to see if it actually cleared
  }

  const stillPresent = await detectCaptcha(page);
  return { solved: !stillPresent.detected };
}
