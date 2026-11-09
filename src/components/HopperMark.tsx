/**
 * Hopper brand mark: a grain hopper (wide mouth tapering to a spout) with a play triangle
 * cut through it. Flat, two colours, legible from 32px up. Single source for the nav lockup
 * and the startup animation; the launcher PNGs are rendered from public/hopper-mark.svg.
 */
export const HOPPER_ACCENT = "#2DD4BF";
export const HOPPER_INK = "#0B0F1A";

/** Hopper body outline in a 100x100 box. */
export const HOPPER_BODY_PATH =
  "M14 16H86a6 6 0 0 1 5.4 8.6L68 70v10a6 6 0 0 1-6 6H38a6 6 0 0 1-6-6V70L8.6 24.6A6 6 0 0 1 14 16Z";
/** Play triangle, centred in the hopper's mouth. */
export const HOPPER_PLAY_PATH = "M42 30.5 63 43 42 55.5Z";

export function HopperMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} focusable="false">
      {title ? <title>{title}</title> : null}
      <path d={HOPPER_BODY_PATH} fill={HOPPER_ACCENT} />
      <path d={HOPPER_PLAY_PATH} fill={HOPPER_INK} strokeLinejoin="round" stroke={HOPPER_INK} strokeWidth="3" />
    </svg>
  );
}

/** Mark + "Hopper" word, for the top navigation. */
export function HopperLockup() {
  return (
    <span className="hopper-lockup">
      <HopperMark className="hopper-lockup-mark" />
      <span className="hopper-lockup-word">Hopper</span>
    </span>
  );
}
