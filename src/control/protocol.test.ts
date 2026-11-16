import { describe, expect, it } from "vitest";
import { decode, idleState, launchIntent, serverIdOf, serverMatches, stateBody, tvHello } from "./protocol";

const hello = { type: "hello", v: 2, hello: { role: "phone", deviceName: "Pixel", deviceId: "p1", serverId: "abc", supportedVersions: [1, 2], features: ["close_reason"] } };

describe("decode", () => {
  it("accepts a phone hello and keeps its fields", () => {
    const decoded = decode(hello);
    expect(decoded).toMatchObject({ kind: "message", type: "hello", payload: { deviceName: "Pixel", supportedVersions: [1, 2] } });
  });

  it("closes on a known type with a malformed payload", () => {
    expect(decode({ type: "hello", hello: { role: "phone" } })).toEqual({ kind: "invalid" });
    expect(decode({ type: "launch", launch: { serverId: "s", playback: { contentId: "c" } } })).toEqual({ kind: "invalid" });
    expect(decode({ type: "control", control: { name: "seek", seconds: "ten" } })).toEqual({ kind: "invalid" });
    expect(decode({ v: 2 })).toEqual({ kind: "invalid" });
  });

  it("ignores unknown types, unknown commands and messages only a TV sends", () => {
    expect(decode({ type: "something_new" }).kind).toBe("ignored");
    expect(decode({ type: "control", control: { name: "rewind_time" } }).kind).toBe("ignored");
    expect(decode({ type: "set_hdr_enabled" }).kind).toBe("ignored");
    expect(decode({ type: "state", state: {} }).kind).toBe("ignored");
  });

  it("accepts a control command with its value fields", () => {
    expect(decode({ type: "control", v: 2, control: { name: "select_subtitle_track", trackId: 3 } }))
      .toMatchObject({ kind: "message", type: "control", payload: { name: "select_subtitle_track", trackId: 3 } });
  });
});

describe("servers", () => {
  it("names a server as the phones do: base64url of the trimmed URL, no padding", () => {
    const url = "https://silo.example.com/";
    const phone = Buffer.from("https://silo.example.com", "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(serverIdOf(url)).toBe(phone);
  });

  it("matches by key, by an equivalent URL, or by the deployment identity", () => {
    const origin = "https://silo.example.com";
    expect(serverMatches(serverIdOf(origin), undefined, origin)).toBe(true);
    expect(serverMatches(serverIdOf("HTTPS://Silo.Example.com:443/"), undefined, origin)).toBe(true);
    expect(serverMatches(serverIdOf("http://192.168.1.5:8080"), "id-1", origin, "id-1")).toBe(true);
    expect(serverMatches(serverIdOf("http://192.168.1.5:8080"), "id-2", origin, "id-1")).toBe(false);
    expect(serverMatches("", "", origin, "")).toBe(false);
  });
});

describe("state", () => {
  // Every field the Android phone's SiloCastPlaybackState requires; a missing one drops the session.
  const required = ["title", "isPlaying", "isLoading", "isBuffering", "currentTime", "duration", "audioTracks", "subtitleTracks",
    "qualityOptions", "activeQualityId", "isQualitySwitching", "playbackSpeed", "videoGravity", "hdrEnabled",
    "supportsVideoGravity", "supportsHDRToggle", "volume", "isMuted", "hasNextEpisode"];

  it("has every required field, idle or playing", () => {
    const playing = stateBody({
      contentId: "c1", title: "Sintel", currentTime: 32.5, duration: 888, isPlaying: true, isLoading: false, isBuffering: false,
      audioTracks: [{ trackId: 0, title: "English · AAC" }], selectedAudioTrackId: 0,
      subtitleTracks: [{ trackId: 2, title: "French", detail: "SRT" }], qualityOptions: [{ id: "auto", label: "Auto" }],
      activeQualityId: "auto", isQualitySwitching: false, playbackSpeed: 1.5, isMuted: true, hasNextEpisode: false
    });
    for (const body of [idleState(), playing]) for (const key of required) expect(body).toHaveProperty(key);
    expect(playing).toMatchObject({ volume: 0, isMuted: true, playbackSpeed: 1.5, subtitleTracks: [{ kind: "subtitle", trackId: 2, title: "French", detail: "SRT" }], selectedSubtitleTrackId: null });
    expect(idleState()).toMatchObject({ title: "Ready", contentId: null, isPlaying: false });
  });
});

describe("launchIntent", () => {
  it("starts from the beginning, at a position, or where the server's resume rule says", () => {
    expect(launchIntent({ contentId: "c", startFromBeginning: true, resumePosition: 90 }).startPosition).toBe(0);
    expect(launchIntent({ contentId: "c", startFromBeginning: false, resumePosition: 90 }).startPosition).toBe(90);
    expect(launchIntent({ contentId: "c", startFromBeginning: false }).startPosition).toBeUndefined();
  });

  it("takes the server's track numbers, a negative subtitle index meaning none", () => {
    expect(launchIntent({ contentId: "c", startFromBeginning: false, fileId: 7, audioTrackIndex: 1, subtitleTrackIndex: -1 }).choices)
      .toEqual({ fileId: 7, audioIndex: 1, subtitleOff: true });
    expect(launchIntent({ contentId: "c", startFromBeginning: false, subtitleTrackIndex: 4 }).choices).toEqual({ subtitleIndex: 4 });
    expect(launchIntent({ contentId: "c", startFromBeginning: false }).choices).toBeUndefined();
  });
});

describe("tvHello", () => {
  it("says it is a TV on protocol 2 that mutes but can't set a level", () => {
    const body = tvHello({ deviceName: "Living room", deviceId: "d", serverId: "s", serverName: "Silo" });
    expect(body).toMatchObject({ role: "tv", supportedVersions: [2] });
    expect(body.features).toContain("volume_mute_only");
    expect(body).not.toHaveProperty("serverIdentity");
  });
});
