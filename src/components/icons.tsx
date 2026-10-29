export function WatchlistIcon({ active }: { active: boolean }) {
  return (
    <svg className="tv-button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.6L5 21V4a1 1 0 0 1 1-1z"
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg className="tv-button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
    </svg>
  );
}

export function RestartIcon() {
  return (
    <svg className="tv-button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 5V2L7 6l5 4V7a5.5 5.5 0 1 1-5.5 5.5H4.5A7.5 7.5 0 1 0 12 5z" fill="currentColor" />
    </svg>
  );
}

export function GearIcon() {
  return (
    <svg className="tv-button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5zm0 2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z" fill="currentColor" />
      <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3 1a7.7 7.7 0 0 0-2.6-1.5L14 2.6h-4l-.5 2.5a7.7 7.7 0 0 0-2.6 1.5l-2.3-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-1a7.7 7.7 0 0 0 2.6 1.5l.5 2.5h4l.5-2.5a7.7 7.7 0 0 0 2.6-1.5l2.3 1 2-3.4zM12 18a6 6 0 1 1 0-12 6 6 0 0 1 0 12z" fill="currentColor" />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg className="tv-button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="6" cy="12" r="1.8" fill="currentColor" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <circle cx="18" cy="12" r="1.8" fill="currentColor" />
    </svg>
  );
}
