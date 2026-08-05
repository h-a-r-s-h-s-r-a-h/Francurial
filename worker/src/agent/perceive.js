/**
 * Freshly queries the DOM every step (never reuses a selector computed on a
 * previous step) — this is what gives "self-healing selectors": if the page
 * re-renders and old selectors go stale, the next perceive() just finds the
 * new elements under their current attributes.
 */
export async function perceive(page) {
  const url = page.url();
  const title = await page.title().catch(() => "");

  const { elements, textMatches } = await page.evaluate(() => {
    let nextIdx = 0;

    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };

    const selectorFor = (el) => {
      if (el.id) return `#${CSS.escape(el.id)}`;
      if (el.getAttribute("data-testid")) return `[data-testid="${el.getAttribute("data-testid")}"]`;
      if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
      // nth-of-type is scoped to sibling position under a shared parent — a
      // flat index across the whole page has no relationship to that, so
      // building "tag:nth-of-type(flatIndex)" produces a selector that
      // matches nothing real. Tag the element directly instead: guaranteed
      // correct, re-tagged fresh every perceive() call. Shared counter across
      // both interactive elements and text matches so tags never collide.
      const idx = nextIdx++;
      el.setAttribute("data-fc-idx", String(idx));
      return `[data-fc-idx="${idx}"]`;
    };

    const candidates = Array.from(
      document.querySelectorAll("a, button, input, select, textarea, [role=button], [onclick]")
    );

    const elements = candidates
      .filter(isVisible)
      .slice(0, 120)
      .map((el) => {
        const isPassword = (el.getAttribute("type") || "").toLowerCase() === "password";
        // el.value is the real plaintext regardless of type="password" —
        // that masking is purely visual rendering, not a JS-level
        // restriction. Without this guard, the actual password gets
        // serialized into visible_elements and sent to the LLM on every
        // perceive() AFTER the one that typed it, defeating the entire
        // "never show credentials to the model" design.
        const rawText = isPassword ? (el.value ? "[hidden]" : "") : el.innerText || el.value || el.getAttribute("aria-label") || "";
        return {
          tag: el.tagName.toLowerCase(),
          selector: selectorFor(el),
          text: rawText.trim().slice(0, 80),
          type: el.getAttribute("type") || undefined,
          placeholder: el.getAttribute("placeholder") || undefined,
        };
      });

    // perceive() above only ever looks at interactive tags — any plain
    // readable fact (price, quota, rating, date, count) almost always lives
    // in a <span>/<div>/<p>, which never enters that list. Originally this
    // only matched currency-formatted text ("find the price of X" tasks) —
    // too narrow: a task asking for e.g. "0 / 500 calls per day" trial
    // usage has no currency symbol, so it never surfaced here, and the
    // model had no legitimate way to read it at all. It resorted to
    // guessing extract(selector="body") to read the whole page instead —
    // which "succeeds" every time (body always exists) and loops forever
    // rather than failing fast. Broadened to any short leaf text
    // containing a digit — covers prices, quotas, percentages, counts,
    // dates — so the answer can come from this same perceive() call
    // instead of the model needing to invent a selector to find it.
    const factRegex = /\d/;
    const textMatches = Array.from(document.querySelectorAll("body *"))
      .filter((el) => el.children.length === 0)
      .filter((el) => {
        const t = (el.innerText || "").trim();
        return t.length > 0 && t.length <= 100 && factRegex.test(t);
      })
      .filter(isVisible)
      .slice(0, 40)
      .map((el) => ({
        selector: selectorFor(el),
        text: (el.innerText || "").trim().slice(0, 80),
      }));

    return { elements, textMatches };
  });

  const knownSelectors = new Set([...elements.map((e) => e.selector), ...textMatches.map((t) => t.selector)]);
  return { url, title, elements, textMatches, knownSelectors };
}
