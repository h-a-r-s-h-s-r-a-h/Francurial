export async function act(page, action, { credentials } = {}) {
  switch (action.name) {
    case "navigate":
      await page.goto(action.args.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      return { ok: true };
    case "click":
      await page.locator(action.args.selector).first().click({ timeout: 10_000 });
      return { ok: true };
    case "type":
      await page.locator(action.args.selector).first().fill(action.args.text, { timeout: 10_000 });
      return { ok: true };
    case "type_credential": {
      const value = credentials?.[action.args.field];
      if (!value) throw new Error(`no stored credential for field '${action.args.field}'`);
      await page.locator(action.args.selector).first().fill(value, { timeout: 10_000 });
      return { ok: true };
    }
    case "press_key":
      await page.keyboard.press(action.args.key);
      return { ok: true };
    case "wait":
      await page.waitForTimeout(Math.min(action.args.ms || 1000, 15_000));
      return { ok: true };
    case "extract": {
      const text = await page.locator(action.args.selector).first().innerText({ timeout: 10_000 });
      return { ok: true, extracted: text };
    }
    case "finish":
      return { ok: true, finished: true };
    default:
      throw new Error(`unknown action: ${action.name}`);
  }
}
