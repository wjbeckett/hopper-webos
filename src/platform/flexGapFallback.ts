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
 * A container's display and direction are taken from the gap rule itself, then from other
 * rules with the same selector (later ones win). A selector whose display is set only through
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

function gapOf(rule: Rule) {
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

export function flexGapFallback(css: string): string {
  const root = postcss.parse(css);
  const pseudos = pseudoSelectors(root);
  const bySelector = new Map<string, Layout>();
  root.walkRules(rule => {
    if (rule.parent?.type === "atrule" && /keyframes$/i.test((rule.parent as AtRule).name)) return;
    for (const selector of rule.selectors) bySelector.set(selector, readLayout(rule, bySelector.get(selector) ?? {}));
  });

  const out = postcss.root();
  root.walkRules(rule => {
    const gap = gapOf(rule);
    if (!gap) return;
    const own = readLayout(rule, {});
    const children: { selector: string; decls: Record<string, string> }[] = [];
    for (const selector of rule.selectors) {
      const layout = { ...bySelector.get(selector), ...Object.fromEntries(Object.entries(own).filter(([, value]) => value !== undefined)) };
      if (!/flex/.test(layout.display ?? "")) continue;
      const direction = layout.direction ?? "row";
      const column = direction.startsWith("column");
      const reversed = direction.endsWith("-reverse");
      const size = column ? gap.row : gap.column;
      if (!isZero(size)) {
        const leading = column ? (reversed ? "margin-bottom" : "margin-top") : (reversed ? "margin-right" : "margin-left");
        const trailing = column ? (reversed ? "margin-top" : "margin-bottom") : (reversed ? "margin-left" : "margin-right");
        for (const pseudo of pseudosOf(selector, pseudos)) children.push({ selector: pseudo.selector, decls: { [pseudo.kind === "after" ? leading : trailing]: size! } });
      }
      if (column) {
        if (isZero(gap.row)) continue;
        children.push({ selector: `${selector} > * + *`, decls: { [reversed ? "margin-bottom" : "margin-top"]: gap.row! } });
      } else {
        if (isZero(gap.column)) continue;
        children.push({ selector: `${selector} > * + *`, decls: { [reversed ? "margin-right" : "margin-left"]: gap.column! } });
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
  return out.toString();
}
