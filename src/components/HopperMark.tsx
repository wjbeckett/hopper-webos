import { useId } from "react";

/**
 * Hopper brand mark (same artwork as brand/hopper-icon.svg, without the background):
 * three poster tiles drop into an aurora-gradient hopper that carries a play button,
 * with a glow under the spout. Each part has a class so the startup splash can animate it.
 */
export function HopperMark({ className, glow = true }: { className?: string; glow?: boolean }) {
  // Gradient ids must be unique per instance (nav + splash can both be mounted).
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = (name: string) => `${name}-${uid}`;
  return (
    <svg className={className} viewBox="180 110 664 840" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id("aurora")} x1="0.12" y1="0.05" x2="0.88" y2="1">
          <stop offset="0" stopColor="#5EEAD4" />
          <stop offset="0.5" stopColor="#818CF8" />
          <stop offset="1" stopColor="#F472B6" />
        </linearGradient>
        <linearGradient id={id("rim")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#99F6E4" />
          <stop offset="1" stopColor="#C4B5FD" />
        </linearGradient>
        <radialGradient id={id("glow")} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#F9A8D4" stopOpacity="0.9" />
          <stop offset="1" stopColor="#F472B6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id("tileA")} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5EEAD4" /><stop offset="1" stopColor="#2DD4BF" /></linearGradient>
        <linearGradient id={id("tileB")} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#A5B4FC" /><stop offset="1" stopColor="#818CF8" /></linearGradient>
        <linearGradient id={id("tileC")} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FBCFE8" /><stop offset="1" stopColor="#F472B6" /></linearGradient>
      </defs>
      {/* hopper-react wraps the tiles and the hopper so the splash can dip them together when a tile lands. */}
      <g className="hopper-react">
        {/* Tiles: outer group carries the drop animation, inner rect keeps its resting tilt. */}
        <g className="hopper-tile hopper-tile-a"><rect x="300" y="196" width="150" height="214" rx="22" fill={`url(#${id("tileA")})`} transform="rotate(-16 375 303)" /></g>
        <g className="hopper-tile hopper-tile-c"><rect x="575" y="176" width="150" height="214" rx="22" fill={`url(#${id("tileC")})`} transform="rotate(14 650 283)" /></g>
        <g className="hopper-tile hopper-tile-b"><rect x="437" y="128" width="150" height="214" rx="22" fill={`url(#${id("tileB")})`} transform="rotate(-3 512 235)" /></g>
        <g className="hopper-body">
          <path d="M232 404H792a34 34 0 0 1 29 51L612 790v64a30 30 0 0 1-30 30H442a30 30 0 0 1-30-30v-64L203 455a34 34 0 0 1 29-51Z" fill={`url(#${id("aurora")})`} />
          <path d="M232 404H792a34 34 0 0 1 30 18H202a34 34 0 0 1 30-18Z" fill={`url(#${id("rim")})`} />
          <path className="hopper-play" d="M470 500c0-16 17-26 31-18l122 72c14 8 14 28 0 36l-122 72c-14 8-31-2-31-18Z" fill="#0E1030" />
        </g>
        </g>
      {glow ? <ellipse className="hopper-glow" cx="512" cy="912" rx="150" ry="40" fill={`url(#${id("glow")})`} /> : null}
    </svg>
  );
}

/** Mark + "Hopper" word, for the top navigation. */
export function HopperLockup() {
  return (
    <span className="hopper-lockup">
      <HopperMark className="hopper-lockup-mark" glow={false} />
      <span className="hopper-lockup-word">Hopper</span>
    </span>
  );
}
