/**
 * Freshly queries the DOM every step (never reuses a selector computed on a
 * previous step) — this is what gives "self-healing selectors": if the page
 * re-renders and old selectors go stale, the next perceive() just finds the
 * new elements under their current attributes.
 */
export async function perceive(page) {
  const url = page.url();
  const title = await page.title().catch(() => "");

  const elements = await page.evaluate(() => {
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };

    const selectorFor = (el, index) => {
      if (el.id) return `#${CSS.escape(el.id)}`;
      if (el.getAttribute("data-testid")) return `[data-testid="${el.getAttribute("data-testid")}"]`;
      if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
      return `${el.tagName.toLowerCase()}:nth-of-type(${index + 1})`;
    };

    const candidates = Array.from(
      document.querySelectorAll("a, button, input, select, textarea, [role=button], [onclick]")
    );

    return candidates
      .filter(isVisible)
      .slice(0, 120)
      .map((el, index) => ({
        tag: el.tagName.toLowerCase(),
        selector: selectorFor(el, index),
        text: (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 80),
        type: el.getAttribute("type") || undefined,
        placeholder: el.getAttribute("placeholder") || undefined,
      }));
  });

  return { url, title, elements };
}
