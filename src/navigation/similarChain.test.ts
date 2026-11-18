import { describe, expect, it } from "vitest";
import { nextInChain, type ChainPage } from "./similarChain";

interface Page extends ChainPage<Page> { name: string }
const page = (id: string): Page => ({ name: "details", item: { Id: id } });

describe("More Like This chain (#177)", () => {
  it("opens the first pick on top of the title it came from", () => {
    expect(nextInChain(page("a"), page("b"))).toEqual({ ...page("b"), chainStart: page("a") });
  });

  it("replaces later picks, keeping where the chain started", () => {
    const b = nextInChain(page("a"), page("b"))!;
    const c = nextInChain(b, page("c"))!;
    const d = nextInChain(c, page("d"))!;
    expect(d.chainStart).toEqual(page("a"));
  });

  it("goes back to the starting title when it is picked again", () => {
    const b = nextInChain(page("a"), page("b"))!;
    expect(nextInChain(b, page("a"))).toEqual(page("a"));
  });

  it("does nothing for the title already showing", () => {
    const b = nextInChain(page("a"), page("b"))!;
    expect(nextInChain(b, page("b"))).toBeNull();
  });
});
