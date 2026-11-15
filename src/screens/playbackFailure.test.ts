import { describe, expect, it } from "vitest";
import { classifyPlaybackFailure } from "./playbackFailure";

describe("classifyPlaybackFailure", () => {
  it("treats media errors 3 and 4 as decoder failures", () => {
    expect(classifyPlaybackFailure({ mediaErrorCode: 3 })).toEqual({ classification: "decoder_failure", message: "media error 3" });
    expect(classifyPlaybackFailure({ mediaErrorCode: 4 }).classification).toBe("decoder_failure");
    expect(classifyPlaybackFailure({ mediaErrorCode: 1 }).classification).toBe("player_failure");
  });

  it("treats hls.js buffer and parsing errors as decoder failures", () => {
    expect(classifyPlaybackFailure({ hlsDetails: "bufferAddCodecError" }).classification).toBe("decoder_failure");
    expect(classifyPlaybackFailure({ hlsDetails: "fragParsingError" }).classification).toBe("decoder_failure");
  });

  it("uses the HTTP status when the server answered with an error", () => {
    expect(classifyPlaybackFailure({ hlsDetails: "fragLoadError", httpStatus: 404 })).toEqual({ classification: "source_unavailable", message: "hls fragLoadError (HTTP 404)" });
    expect(classifyPlaybackFailure({ hlsDetails: "manifestLoadError", httpStatus: 500 }).classification).toBe("http_failure");
  });

  it("falls back to player_failure", () => {
    expect(classifyPlaybackFailure({ hlsDetails: "internalException" }).classification).toBe("player_failure");
    expect(classifyPlaybackFailure({}).classification).toBe("player_failure");
  });
});
