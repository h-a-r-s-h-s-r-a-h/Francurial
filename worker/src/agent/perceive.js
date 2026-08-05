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
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        selector: selectorFor(el),
        text: (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 80),
        type: el.getAttribute("type") || undefined,
        placeholder: el.getAttribute("placeholder") || undefined,
      }));

    // perceive() above only ever looks at interactive tags — a price,
    // rating, or any other plain readable fact almost always lives in a
    // <span>/<div>/<p>, which never enters that list. Without this, the
    // agent can click into the exact right page and still have no way to
    // select or read the text it was asked to find. Surface any leaf
    // element (no element children — avoids matching giant container divs)
    // whose text looks like a price, so the answer can come straight from
    // this same perceive() call instead of needing a separate extract step.
    const priceRegex = /[₹$€£]\s?[\d,]+(\.\d+)?/;
    const textMatches = Array.from(document.querySelectorAll("body *"))
      .filter((el) => el.children.length === 0)
      .filter((el) => priceRegex.test(el.innerText || ""))
      .filter(isVisible)
      .slice(0, 30)
      .map((el) => ({
        selector: selectorFor(el),
        text: (el.innerText || "").trim().slice(0, 80),
      }));

    return { elements, textMatches };
  });

  return { url, title, elements, textMatches };
}
