const CAPTCHA_MARKERS = [
  'iframe[src*="captcha" i]',
  'iframe[title*="captcha" i]',
  ".g-recaptcha",
  "#g-recaptcha",
  ".h-captcha",
  ".cf-turnstile",
  '[class*="captcha" i]',
  // Cloudflare's own auto-generated challenge page (not a site owner's manual
  // Turnstile embed) doesn't carry the ".cf-turnstile"/"#challenge-stage"
  // markers at all — confirmed by direct inspection against a real Cloudflare
  // challenge page. It uses container IDs prefixed "cf-chl-", and the actual
  // widget lives inside a shadow root these selectors can't see into anyway
  // (this is deliberate anti-automation on Cloudflare's part) — the ID prefix
  // is the reliable, verified signal that one is present at all.
  '[id^="cf-chl"]',
];

// Cloudflare's interstitial title flips to one of these well before its
// container ID becomes queryable (measured: title at +1s, [id^="cf-chl"] not
// until +2s) — checking title text first catches it faster than waiting on
// the DOM marker below.
const TITLE_MARKERS = /captcha|just a moment|checking your browser|attention required/i;

/**
 * page.locator(...).isVisible() does NOT auto-wait — it checks the DOM at
 * that exact instant. Challenge widgets are frequently injected async, so a
 * single instantaneous check can in principle miss one that's about to
 * render. That used to be "fixed" here by polling 3x with 700ms waits — but
 * this function already runs fresh on every single agentLoop step, so a
 * miss at step N gets caught by step N+1 a couple seconds later regardless.
 * The internal poll was redundant with that outer retry and cost ~1.4s+ on
 * EVERY step, forever, whether or not a captcha was ever present — measured
 * via timing logs, not assumed. One fast pass per call; rely on the loop's
 * natural cadence for the rare async-injection edge case.
 */
export async function detectCaptcha(page) {
  const title = await page.title().catch(() => "");
  if (TITLE_MARKERS.test(title)) {
    return { detected: true, selector: null, via: "title" };
  }

  for (const selector of CAPTCHA_MARKERS) {
    const found = await page.locator(selector).first().isVisible().catch(() => false);
    if (found) return { detected: true, selector, via: "dom" };
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
