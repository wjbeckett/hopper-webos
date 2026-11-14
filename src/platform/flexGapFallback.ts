import postcss, { type AtRule, type Container, type Root, type Rule } from "postcss";

/**
 * Build-time only (vite.config.ts): makes the stylesheet that stands in for flex `gap` on TVs
 * whose browser ignores it. Flex `gap` arrived in Chrome 84; webOS 6 runs Chrome 79. Grid `gap`
 * works there and is left alone.
 *
 * Each rule that puts a gap on a flex container gets a margin rule for its children, in the
 * same @media block:
 * - a row: `> * + *` gets margin-left (margin-right for row-reverse)
 * - a column: `> * + *` gets margin-top (margin-bottom for column-reverse)
 * - a row that wraps is treated as a row. Hopper's wrapping rows (actions, facts, metadata)
 *   nearly always fit on one line, where this is exact; a line that does wrap starts with one
 *   gap of indent and touches the line above. Spacing every child instead made each row
 *   taller by a gap even on one line, which moved the Details hero.
 * - a ::before or ::after that the stylesheet gives the container (a flex item too, which
 *   `> *` cannot select) gets the margin on its side, unless it is positioned out of the flow
 *
 * The result goes in a file of its own that platform/flexGap.ts loads only when the browser
 * lacks flex gap, so TVs that have it never match these selectors.
 *
 * `gap: inherit` takes the parent's gap: for `.row > .strip { gap: inherit }` that is the gap
 * written for `.row` (attribute and pseudo-class selectors aside).
 *
 * A container's display and direction are the last ones written for its selector, in any rule
 * (`.a { display: flex; gap: 12px }` followed by `.a { display: grid }` is a grid). A selector whose display is set only through
 * another selector is not seen; such a rule gets no fallback.
 */
const LAYOUT_PROPS = new Set(["display", "flex-direction", "flex-flow"]);

type Layout = { display?: string; direction?: string };

function readLayout(rule: Rule, into: Layout) {
  rule.each(node => {
    if (node.type !== "decl" || !LAYOUT_PROPS.has(node.prop)) return;
    const value = node.value.trim();
    if (node.prop === "display") into.display = value;
    else if (node.prop === "flex-direction") into.direction = value;
    else {
      const direction = value.match(/\b(row|column)(-reverse)?\b/);
      if (direction) into.direction = direction[0];
    }
  });
  return into;
}

type Gap = { row?: string; column?: string };

/** `.a[data-x]:focus` → `.a`: the selector a gap or layout is usually written under. */
const plainSelector = (selector: string) => selector.replace(/\[[^\]]*\]/g, "").replace(/::?[\w-]+(\([^)]*\))?/g, "").trim();

function gapOf(rule: Rule): Gap | null {
  let row: string | undefined;
  let column: string | undefined;
  rule.each(node => {
    if (node.type !== "decl") return;
    if (node.prop === "gap") {
      const parts = postcss.list.space(node.value);
      row = parts[0];
      column = parts[1] ?? parts[0];
    } else if (node.prop === "row-gap") row = node.value;
    else if (node.prop === "column-gap") column = node.value;
  });
  return row === undefined && column === undefined ? null : { row, column };
}

const isZero = (value: string | undefined) => !value || /^0(px|rem|em|%)?$/.test(value.trim()) || value.trim() === "normal";

/** The @media (or other at-rule) blocks around a rule, outermost first. */
function wrappers(rule: Rule) {
  const chain: AtRule[] = [];
  let parent: Container | Root | undefined = rule.parent as Container | undefined;
  while (parent && parent.type === "atrule") {
    chain.unshift(parent as AtRule);
    parent = parent.parent as Container | undefined;
  }
  return chain;
}

/** Selectors of in-flow ::before/::after pseudo-elements, as written ("a:not(.b)::after"). */
function pseudoSelectors(root: Root) {
  const found = new Map<string, boolean>();
  root.walkRules(rule => {
    for (const selector of rule.selectors) {
      if (!/::?(before|after)$/.test(selector)) continue;
      let outOfFlow = found.get(selector) ?? false;
      rule.each(node => {
        if (node.type === "decl" && node.prop === "position" && /absolute|fixed/.test(node.value)) outOfFlow = true;
      });
      found.set(selector, outOfFlow);
    }
  });
  return found;
}

/** The pseudo-elements written for `selector` itself, optionally narrowed by pseudo-classes. */
function pseudosOf(selector: string, pseudos: Map<string, boolean>) {
  const matches: { selector: string; kind: "before" | "after" }[] = [];
  for (const [pseudo, outOfFlow] of pseudos) {
    if (outOfFlow || !pseudo.startsWith(selector)) continue;
    const rest = pseudo.slice(selector.length).match(/^((?::[\w-]+(?:\([^)]*\))?)*)::?(before|after)$/);
    if (rest) matches.push({ selector: pseudo, kind: rest[2] as "before" | "after" });
  }
  return matches;
}

/**
 * Flex items the rules above cannot see: pseudo-elements styled under a different selector from
 * the one that sets their container's gap. Keep the sizes in step with styles.css.
 */
export const HAND_WRITTEN = `
/* The chevron: .settings-pane .option-row { gap: 24px } */
.settings-row:not(.settings-toggle)::after { margin-left: 24px; }
/* The "·" before a time-left ring in the hero: its own 10px plus .details-remaining { gap: 8px } */
.home-featured-metadata .details-remaining::before { margin-right: 18px; }
`;

export function flexGapFallback(css: string): string {
  const root = postcss.parse(css);
  const pseudos = pseudoSelectors(root);
  const bySelector = new Map<string, Layout>();
  const gapBySelector = new Map<string, Gap>();
  root.walkRules(rule => {
    if (rule.parent?.type === "atrule" && /keyframes$/i.test((rule.parent as AtRule).name)) return;
    const gap = gapOf(rule);
    for (const selector of rule.selectors) {
      bySelector.set(selector, readLayout(rule, bySelector.get(selector) ?? {}));
      if (gap && rule.parent?.type === "root") gapBySelector.set(plainSelector(selector), { ...gapBySelector.get(plainSelector(selector)), ...gap });
    }
  });
  /** An `inherit` gap value resolved from the parent compound of `selector`. */
  const resolve = (value: string | undefined, selector: string, side: keyof Gap) => {
    if (value !== "inherit") return value;
    const parent = selector.match(/^(.*?)\s*>\s*[^>]+$/)?.[1];
    return parent ? gapBySelector.get(plainSelector(parent))?.[side] : undefined;
  };

  const out = postcss.root();
  root.walkRules(rule => {
    const gap = gapOf(rule);
    if (!gap) return;
    const children: { selector: string; decls: Record<string, string> }[] = [];
    for (const selector of rule.selectors) {
      const layout = bySelector.get(selector) ?? {};
      if (!/flex/.test(layout.display ?? "")) continue;
      const direction = layout.direction ?? "row";
      const column = direction.startsWith("column");
      const reversed = direction.endsWith("-reverse");
      const rowGap = resolve(gap.row, selector, "row");
      const columnGap = resolve(gap.column, selector, "column");
      const size = column ? rowGap : columnGap;
      if (!isZero(size)) {
        const leading = column ? (reversed ? "margin-bottom" : "margin-top") : (reversed ? "margin-right" : "margin-left");
        const trailing = column ? (reversed ? "margin-top" : "margin-bottom") : (reversed ? "margin-left" : "margin-right");
        for (const pseudo of pseudosOf(selector, pseudos)) children.push({ selector: pseudo.selector, decls: { [pseudo.kind === "after" ? leading : trailing]: size! } });
      }
      if (isZero(size)) continue;
      if (column) {
        children.push({ selector: `${selector} > * + *`, decls: { [reversed ? "margin-bottom" : "margin-top"]: size! } });
      } else {
        children.push({ selector: `${selector} > * + *`, decls: { [reversed ? "margin-right" : "margin-left"]: size! } });
      }
    }
    if (!children.length) return;
    let target: Root | AtRule = out;
    for (const wrapper of wrappers(rule)) {
      const copy: AtRule = postcss.atRule({ name: wrapper.name, params: wrapper.params });
      target.append(copy);
      target = copy;
    }
    for (const child of children) {
      const fallback = postcss.rule({ selector: child.selector });
      for (const [prop, value] of Object.entries(child.decls)) fallback.append(postcss.decl({ prop, value }));
      target.append(fallback);
    }
  });
  return out.toString() + HAND_WRITTEN;
}
