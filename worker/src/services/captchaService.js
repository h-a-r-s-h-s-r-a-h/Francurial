const CAPTCHA_MARKERS = [
  'iframe[src*="captcha" i]',
  'iframe[title*="captcha" i]',
  ".g-recaptcha",
  "#g-recaptcha",
  ".h-captcha",
  ".cf-turnstile",
  '[class*="captcha" i]',
];

const POLL_ATTEMPTS = 3;
const POLL_DELAY_MS = 700;

/**
 * page.locator(...).isVisible() does NOT auto-wait — it checks the DOM at
 * that exact instant. Challenge widgets are frequently injected async
 * (a script loads, then builds the iframe a few hundred ms later), so a
 * single instantaneous check can miss a real captcha that's about to
 * render. Poll briefly, and also check the page title directly — some sites
 * (Flipkart included) title the whole interstitial page e.g. "Flipkart
 * reCAPTCHA", which is a free, instant, race-proof signal.
 */
export async function detectCaptcha(page) {
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt++) {
    const title = await page.title().catch(() => "");
    if (/captcha/i.test(title)) {
      return { detected: true, selector: null, via: "title" };
    }

    for (const selector of CAPTCHA_MARKERS) {
      const found = await page.locator(selector).first().isVisible().catch(() => false);
      if (found) return { detected: true, selector, via: "dom" };
    }

    if (attempt < POLL_ATTEMPTS) await page.waitForTimeout(POLL_DELAY_MS);
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
  if (selector) {
    try {
      const frameLocator = page.frameLocator(selector);
      const checkbox = frameLocator.locator('#recaptcha-anchor, [role="checkbox"]').first();
      if (await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
        await checkbox.click({ timeout: 2000 });
        await page.waitForTimeout(1500);
      }
    } catch {
      // fall through — re-check below to see if it actually cleared
    }
  } else {
    // Detected via page title only (no specific DOM marker found) — nothing
    // concrete to click. Give the async-loaded widget a moment to render and
    // re-check, rather than pretending to solve something we can't locate.
    await page.waitForTimeout(1500);
  }

  const stillPresent = await detectCaptcha(page);
  return { solved: !stillPresent.detected };
}
