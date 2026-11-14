import { describe, expect, it } from "vitest";
import { HAND_WRITTEN, flexGapFallback as generate } from "./flexGapFallback";

/** The generated rules alone, without the hand-written ones every output ends with. */
const flexGapFallback = (css: string) => generate(css).replace(HAND_WRITTEN, "");

const squash = (css: string) => css.replace(/\s+/g, " ").trim();

describe("flexGapFallback", () => {
  it("gives a flex row's children a left margin", () => {
    expect(squash(flexGapFallback(".a { display: flex; gap: 12px; }"))).toBe(".a > * + * { margin-left: 12px }");
  });

  it("uses the row gap for a column and the column gap for a row", () => {
    expect(squash(flexGapFallback(".a { display: flex; flex-direction: column; gap: 4px 10px; }"))).toBe(".a > * + * { margin-top: 4px }");
    expect(squash(flexGapFallback(".a { display: inline-flex; gap: 4px 10px; }"))).toBe(".a > * + * { margin-left: 10px }");
  });

  it("leaves grid gaps alone", () => {
    expect(flexGapFallback(".a { display: grid; gap: 12px; }").trim()).toBe("");
    expect(flexGapFallback(".a, .b { display: flex; gap: 12px; } .a { display: grid; gap: 14px; }").trim()).toBe(".b > * + * {\n    margin-left: 12px\n}");
  });

  it("finds the display and direction in another rule for the same selector", () => {
    const css = ".a { display: flex; flex-flow: column nowrap; } .b, .a { gap: 8px; }";
    expect(squash(flexGapFallback(css))).toBe(".a > * + * { margin-top: 8px }");
  });

  it("treats a wrapping row as a row, so a one-line row keeps its height", () => {
    expect(squash(flexGapFallback(".a { display: flex; flex-wrap: wrap; gap: 4px 10px; }"))).toBe(".a > * + * { margin-left: 10px }");
  });

  it("keeps a gap inside its media query", () => {
    const css = ".a { display: flex; } @media (max-width: 800px) { .a { gap: 6px; } }";
    expect(squash(flexGapFallback(css))).toBe("@media (max-width: 800px) { .a > * + * { margin-left: 6px } }");
  });

  it("uses the reversed side for reversed directions", () => {
    expect(squash(flexGapFallback(".a { display: flex; flex-direction: row-reverse; gap: 5px; }"))).toBe(".a > * + * { margin-right: 5px }");
  });

  it("spaces an in-flow ::after or ::before, which `> *` cannot select", () => {
    const css = ".a { display: flex; gap: 24px; } .a:not(.b)::after { content: \"\"; } .a::before { content: \"\"; position: absolute; }";
    expect(squash(flexGapFallback(css))).toBe(".a:not(.b)::after { margin-left: 24px } .a > * + * { margin-left: 24px }");
  });

  it("resolves gap: inherit from the parent's gap", () => {
    const css = ".row { display: flex; gap: 20px; } .row[data-slide] > .strip { display: flex; gap: inherit; }";
    expect(squash(flexGapFallback(css))).toBe(".row > * + * { margin-left: 20px } .row[data-slide] > .strip > * + * { margin-left: 20px }");
  });

  it("skips an inherited gap it cannot resolve", () => {
    expect(flexGapFallback(".x > .strip { display: flex; gap: inherit; }").trim()).toBe("");
  });

  it("ends with the hand-written rules", () => {
    expect(generate("").trim()).toBe(HAND_WRITTEN.trim());
  });

  it("skips a zero gap", () => {
    expect(flexGapFallback(".a { display: flex; gap: 0; }").trim()).toBe("");
  });
});
