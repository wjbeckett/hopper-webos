/** "1h 12m left" / "28m left" / "45s left": what is left to watch, never a position. */
export function remainingLabel(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m left`;
  if (minutes) return `${minutes}m left`;
  return `${total}s left`;
}

/** Whether a position is a real, unfinished resume point (same rule as the Details Resume button). */
export function isResumable(position: number, duration: number) {
  return position > 30 && duration > 0 && position < duration - 5;
}

/** Progress ring filled to the watched fraction, plus the time left. Used in metadata rows. */
export function ResumeProgress({ position, duration }: { position: number; duration: number }) {
  const fraction = Math.min(1, Math.max(0, position / duration));
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  return (
    <span className="details-remaining">
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <circle cx="10" cy="10" r={radius} className="details-remaining-track" />
        <circle
          cx="10"
          cy="10"
          r={radius}
          className="details-remaining-fill"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
        />
      </svg>
      {/* An element, not a bare text node, so the flex-gap stand-in (platform/flexGap) can space it. */}
      <span>{remainingLabel(duration - position)}</span>
    </span>
  );
}
