import { useEffect, useRef, useState } from "react";
import { setUserRating } from "../api/silo";
import type { Session } from "../types";

/**
 * The profile's own rating of a title (#180), as five stars with half stars (the server's 1 to 10:
 * 7 is 3.5 stars). Hopper's own: Silo's other TV apps don't rate yet (docs/DECISIONS.md).
 *
 * One focus stop, so moving through the page never rates anything. OK starts rating: Left and
 * Right move half a star (down to no rating), OK saves, Back puts the old value back. With the
 * Magic Remote, clicking a star's left or right half sets that value and saves it.
 */
const isBack = (event: KeyboardEvent) =>
  ["Escape", "Backspace", "Back", "GoBack", "BrowserBack"].includes(event.key) || event.keyCode === 461 || event.keyCode === 10009;
const isOk = (event: KeyboardEvent) => event.key === "Enter" || event.key === "OK" || event.keyCode === 13;

export function starsLabel(rating: number) {
  if (rating <= 0) return "Rate";
  const stars = rating / 2;
  return Number.isInteger(stars) ? String(stars) : stars.toFixed(1);
}

const starsSpoken = (rating: number) => rating <= 0 ? "no rating" : `${starsLabel(rating)} ${rating === 2 ? "star" : "stars"}`;

/** One step of Left (-1) or Right (+1), from no rating (0) to five stars (10). */
export function stepRating(rating: number, direction: -1 | 1) {
  return Math.max(0, Math.min(10, rating + direction));
}

export function RatingStars({ session, itemId, rating: initial }: { session: Session; itemId: string; rating?: number }) {
  const [rating, setRating] = useState(initial ?? 0);
  const [draft, setDraft] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const editing = draft != null;
  // The key handler below is installed once per rating session; it reads the latest values here.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const ratingRef = useRef(rating);
  ratingRef.current = rating;

  // A fresher read of the title (or another title) replaces what is shown, unless the viewer is rating.
  useEffect(() => { if (draft == null) setRating(initial ?? 0); }, [itemId, initial]);

  async function save(next: number) {
    const before = ratingRef.current;
    setDraft(null);
    if (next === before) return;
    setRating(next);
    setNotice("");
    try {
      await setUserRating(session, itemId, next);
    } catch {
      setRating(before);
      setNotice("Couldn't save your rating. Try again.");
    }
  }

  // While rating, the arrows, OK and Back are this control's; the page's navigation never sees them.
  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        setDraft(current => stepRating(current ?? 0, event.key === "ArrowLeft" ? -1 : 1));
      } else if (isOk(event)) {
        if (!event.repeat) void save(draftRef.current ?? ratingRef.current);
      } else if (isBack(event)) {
        if (!event.repeat) setDraft(null);
      } else if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (isOk(event) || isBack(event)) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [editing]);

  const shown = draft ?? rating;
  return (
    <div className="rating-stars-row">
      <button
        ref={buttonRef}
        type="button"
        data-tv-focusable="true"
        className={`rating-stars${editing ? " editing" : ""}`}
        aria-label={editing ? `Your rating: ${starsSpoken(shown)}. Left and Right change it, OK saves.` : rating ? `Your rating: ${starsSpoken(rating)}` : "Rate this title"}
        onBlur={() => setDraft(null)}
        onClick={event => {
          // The Magic Remote: a click on a star's half sets it. A click from OK has no position.
          if (event.detail > 0 && event.target instanceof HTMLElement) {
            const star = event.target.closest<HTMLElement>("[data-star]");
            if (star) {
              const box = star.getBoundingClientRect();
              const half = event.clientX < box.left + box.width / 2 ? 1 : 2;
              void save((Number(star.dataset.star) - 1) * 2 + half);
              return;
            }
          }
          if (!editing) setDraft(rating);
        }}
      >
        <span className="rating-stars-glyphs" aria-hidden="true">
          {[1, 2, 3, 4, 5].map(star => {
            const fill = Math.max(0, Math.min(2, shown - (star - 1) * 2));
            return (
              <span key={star} className="rating-star" data-star={star}>
                <span className="rating-star-fill" style={{ width: `${fill * 50}%` }}>★</span>
              </span>
            );
          })}
        </span>
        <span className="rating-stars-label">{editing ? `${starsLabel(shown) === "Rate" ? "No rating" : starsLabel(shown)} · OK to save` : starsLabel(rating)}</span>
      </button>
      {notice ? <span className="rating-stars-notice" role="status">{notice}</span> : null}
    </div>
  );
}
