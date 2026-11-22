import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectPlaybackVersion, type FileVersion, type WatchDetail } from "./playback";

const file = (file_id: number, resolution: string, extra: Partial<FileVersion> = {}): FileVersion => ({ file_id, resolution, ...extra });
const detail = (versions: FileVersion[], user_data?: WatchDetail["user_data"]) => ({ versions, user_data });
const pick = (...args: Parameters<typeof selectPlaybackVersion>) => selectPlaybackVersion(...args)?.file_id;

describe("the file a title opens on (#197)", () => {
  // A webOS TV: the device limit is 2160p.
  beforeEach(() => { vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Web0S; Linux/SmartTV)"); });
  afterEach(() => { vi.restoreAllMocks(); });

  const standard = file(1, "1080p", { edition_key: "standard", edition_raw: "Standard" });
  const extended = file(2, "2160p", { edition_key: "extended", edition_raw: "Extended Cut", hdr: true });

  it("opens on the standard edition with no history, even when another cut is better quality", () => {
    expect(pick(detail([extended, standard]))).toBe(1);
  });

  it("prefers an unnamed edition, then a theatrical one, over any other cut", () => {
    const unnamed = file(3, "720p");
    expect(pick(detail([extended, unnamed]))).toBe(3);
    const theatrical = file(4, "1080p", { edition_key: "theatrical", edition_raw: "Theatrical" });
    const directors = file(5, "2160p", { edition_key: "directors_cut", edition_raw: "Director's Cut" });
    expect(pick(detail([directors, theatrical]))).toBe(4);
  });

  it("compares quality between cuts in the same group", () => {
    const imax = file(6, "2160p", { edition_key: "imax", edition_raw: "IMAX" });
    expect(pick(detail([extended, imax]))).toBe(2); // the same resolution; HDR wins
    const sdr1080 = file(7, "1080p", { edition_key: "imax", edition_raw: "IMAX" });
    expect(pick(detail([sdr1080, extended]))).toBe(2);
  });

  it("picks the best file inside the edition, never a file of another cut", () => {
    const standard4k = file(8, "2160p", { edition_key: "standard", edition_raw: "Standard" });
    expect(pick(detail([extended, standard, standard4k]))).toBe(8);
  });

  it("reopens on the last-played edition, by key and then by file", () => {
    expect(pick(detail([extended, standard], { last_edition_key: "extended" }))).toBe(2);
    expect(pick(detail([extended, standard], { last_file_id: 2 }))).toBe(2);
    // An empty key names the unnamed edition.
    expect(pick(detail([extended, file(3, "720p")], { last_edition_key: "" }))).toBe(3);
    // A key no edition has falls back to the file.
    expect(pick(detail([extended, standard], { last_edition_key: "gone", last_file_id: 2 }))).toBe(2);
  });

  it("uses history for the edition only: Auto picks the file within it", () => {
    const standard4k = file(8, "2160p", { edition_key: "standard", edition_raw: "Standard" });
    expect(pick(detail([extended, standard, standard4k], { last_file_id: 1 }))).toBe(8);
  });

  it("follows the viewer's edition pick over history, and a pinned file over everything", () => {
    const history = { last_edition_key: "extended" };
    expect(pick(detail([extended, standard], history), { editionId: "standard" })).toBe(1);
    expect(pick(detail([extended, standard], history), { editionId: "standard", fileId: 2 })).toBe(2);
  });

  it("stays at or below the device limit, else takes the closest file above it", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Desktop");
    vi.spyOn(screen, "height", "get").mockReturnValue(1080);
    const versions = [file(10, "2160p"), file(11, "1080p"), file(12, "720p")];
    expect(pick(detail(versions))).toBe(11);
    expect(pick(detail([file(13, "4320p"), file(14, "2160p")]))).toBe(14);
  });

  it("takes a file of unknown resolution only when no resolution is known", () => {
    expect(pick(detail([file(20, ""), file(21, "720p")]))).toBe(21);
    expect(pick(detail([file(22, "")]))).toBe(22);
  });

  it("returns nothing for a title with no files", () => {
    expect(pick(detail([]))).toBeUndefined();
  });
});
