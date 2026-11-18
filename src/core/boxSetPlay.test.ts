import { describe, expect, it } from "vitest";
import type { SiloItem } from "../types";
import { boxSetFacts, boxSetPlayTarget } from "./boxSetPlay";

const film = (id: string, user?: SiloItem["UserData"]): SiloItem => ({ Id: id, Name: id, Type: "Movie", UserData: user });

describe("box sets (#171)", () => {
  it("plays the first film of an unwatched box set", () => {
    expect(boxSetPlayTarget([film("a"), film("b")])).toMatchObject({ item: { Id: "a" }, position: 0, label: "Play" });
  });

  it("continues the film in progress", () => {
    const target = boxSetPlayTarget([film("a", { Played: true }), film("b", { PlaybackPositionTicks: 600 * 10_000_000 }), film("c")]);
    expect(target).toMatchObject({ item: { Id: "b" }, position: 600, label: "Continue" });
  });

  it("continues with the first unwatched film after watched ones", () => {
    expect(boxSetPlayTarget([film("a", { Played: true }), film("b")])).toMatchObject({ item: { Id: "b" }, label: "Continue" });
  });

  it("starts over from the first film when all are watched", () => {
    expect(boxSetPlayTarget([film("a", { Played: true }), film("b", { Played: true })])).toMatchObject({ item: { Id: "a" }, label: "Play" });
    expect(boxSetPlayTarget([])).toBeNull();
  });

  it("describes the films and years", () => {
    expect(boxSetFacts(3, 2001, 2003)).toBe("3 films · 2001–2003");
    expect(boxSetFacts(1, 2010, 2010)).toBe("1 film · 2010");
  });
});
