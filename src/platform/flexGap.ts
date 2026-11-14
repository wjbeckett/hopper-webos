/**
 * Flex `gap` arrived in Chrome 84, and webOS 6 runs Chrome 79. On a browser without it the
 * build's stand-in stylesheet (`flex-gap.css`, made by platform/flexGapFallback.ts) is loaded
 * ahead of the main one. Browsers with flex gap never load it.
 */
export function supportsFlexGap() {
  const probe = document.createElement("div");
  probe.style.cssText = "display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden";
  probe.appendChild(document.createElement("div"));
  probe.appendChild(document.createElement("div"));
  document.documentElement.appendChild(probe);
  const supported = probe.scrollHeight === 1;
  probe.parentNode?.removeChild(probe);
  return supported;
}

export function loadFlexGapFallback() {
  if (import.meta.env.DEV || supportsFlexGap()) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./flex-gap.css";
  // Before the main stylesheet, so a margin a child sets on purpose (margin-top: auto that pushes
  // it to the end, say) still wins at equal specificity. Where both apply, that child loses the
  // gap rather than its own margin.
  document.head.insertBefore(link, document.head.querySelector('link[rel="stylesheet"]'));
  console.info("[Hopper] no flex gap: loaded flex-gap.css");
}
