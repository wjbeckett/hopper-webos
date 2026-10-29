import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isFavorite, setFavorite, setWatched } from "../api/silo";
import { applyWatchedState, publishWatchState, subscribeWatchState } from "../core/watchState";
import { setWatchlist } from "../api/silo";
import type { Session, SiloItem } from "../types";

function WatchlistCardRow({ session, item, inWatchlist, onDone }: { session: Session; item: SiloItem; inWatchlist: boolean; onDone: () => void }) {
  return (
    <button type="button" data-tv-focusable="true" className="browse-panel-row" onClick={() => {
      onDone();
      void setWatchlist(session, item.Id, !inWatchlist).catch(() => undefined);
    }}>
      <span>{inWatchlist ? "Remove from Watchlist" : "Add to Watchlist"}</span>
    </button>
  );
}

type Props = {
  session: Session;
  item: SiloItem;
  image: string;
  onOpen: () => void;
  landscape?: boolean;
  variant?: "browse";
  square?: boolean;
  caption?: string;
};

function subtitle(item: SiloItem) {
  if (item.Type === "Episode") {
    const season = item.ParentIndexNumber != null ? `S${String(item.ParentIndexNumber).padStart(2, "0")}` : "";
    const episode = item.IndexNumber != null ? `E${String(item.IndexNumber).padStart(2, "0")}` : "";
    return [item.SeriesName, [season, episode].filter(Boolean).join("")].filter(Boolean).join(" · ") || "Episode";
  }
  return [item.Type, item.ProductionYear].filter(Boolean).join(" · ") || "Media";
}

export function MediaCard({ session, item, image, onOpen, landscape = false, variant, square, caption }: Props) {
  const browse = variant === "browse";
  const [live, setLive] = useState(item);
  const progress = Math.max(0, Math.min(100, live.UserData?.PlayedPercentage ?? 0));
  const watched = live.UserData?.Played === true || progress >= 100;
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuFavorite, setMenuFavorite] = useState(false);

  useEffect(() => subscribeWatchState(next => {
    if (next.Id === item.Id) setLive(next);
  }), [item.Id]);
  useEffect(() => setLive(item), [item]);
  const cardRef = useRef<HTMLButtonElement>(null);
  const menuFirstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onOpenMenu = (event: Event) => {
      if (!(event.target instanceof HTMLElement)) return;
      if (!cardRef.current || !cardRef.current.contains(event.target)) return;
      setMenuOpen(true);
    };
    window.addEventListener("silo:open-card-menu", onOpenMenu);
    return () => window.removeEventListener("silo:open-card-menu", onOpenMenu);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    let alive = true;
    isFavorite(session, item.Id).then(next => { if (alive) setMenuFavorite(next); }).catch(() => undefined);
    requestAnimationFrame(() => menuFirstRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (!["Escape", "Backspace", "Back", "GoBack", "BrowserBack"].includes(event.key) && event.keyCode !== 461) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setMenuOpen(false);
      requestAnimationFrame(() => cardRef.current?.focus({ preventScroll: true }));
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [menuOpen, session, item.Id]);

  async function toggleMenuWatched(next: boolean) {
    setMenuOpen(false);
    setLive(current => applyWatchedState(current.Id === item.Id ? current : item, next));
    try {
      await setWatched(session, item.Id, next);
      publishWatchState(applyWatchedState(live, next));
    } catch (cause) {
      console.error(cause);
      setLive(item);
    }
    requestAnimationFrame(() => cardRef.current?.focus({ preventScroll: true }));
  }

  async function toggleMenuFavorite(next: boolean) {
    setMenuOpen(false);
    try {
      await setFavorite(session, item.Id, next);
      setMenuFavorite(next);
    } catch (cause) {
      console.error(cause);
    }
    requestAnimationFrame(() => cardRef.current?.focus({ preventScroll: true }));
  }

  return (
    <div className="media-card-wrap">
    <button
      ref={cardRef}
      data-tv-focusable="true"
      data-menu-context="true"
      data-media-id={item.Id}
      className={`media-card ${landscape ? "landscape" : ""} ${watched ? "watched" : ""} ${browse ? "browse" : ""} ${browse && (square ?? item.Type === "AudioBook") ? "square" : ""}`}
      onClick={onOpen}
      aria-label={item.Name}
    >
      <div className="media-card-art">
        <div className="media-card-placeholder" aria-hidden="true">
          {item.Name.slice(0, 1).toUpperCase()}
        </div>
        {image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            onError={(event) => { event.currentTarget.hidden = true; }}
          />
        ) : null}
        {watched ? (
          browse
            ? <span className="media-card-watched-check" aria-label="Watched">✓</span>
            : <span className="media-card-watched" aria-label="Watched">✓ Watched</span>
        ) : null}
        {!browse && progress > 0 && progress < 100 ? (
          <div className="progress-track" aria-label={`${Math.round(progress)}% watched`}><span style={{ width: `${progress}%` }} /></div>
        ) : null}
      </div>
      <div className="media-card-title">{live.Name}</div>
      <div className="media-card-meta">{caption ?? (browse ? live.ProductionYear || "" : subtitle(live))}</div>
    </button>
    {menuOpen ? createPortal(
      <div className="details-more-scrim" data-modal="true" onClick={() => { setMenuOpen(false); requestAnimationFrame(() => cardRef.current?.focus({ preventScroll: true })); }}>
        <div className="details-more card-menu" role="dialog" aria-label={`${item.Name} Actions`} onClick={event => event.stopPropagation()}>
          <button ref={menuFirstRef} type="button" data-tv-focusable="true" className="browse-panel-row" onClick={() => { setMenuOpen(false); onOpen(); }}>
            <span>Play</span>
          </button>
          {item.Type !== "Series" && item.Type !== "AudioBook" ? (
            <button type="button" data-tv-focusable="true" className="browse-panel-row" onClick={() => void toggleMenuWatched(!watched)}>
              <span>{watched ? "Mark Unwatched" : "Mark Watched"}</span>
            </button>
          ) : null}
          {item.Type === "Series" || item.Type === "AudioBook" ? null : null}
          <button type="button" data-tv-focusable="true" className="browse-panel-row" onClick={() => void toggleMenuFavorite(!menuFavorite)}>
            <span>{menuFavorite ? "Remove from Favorites" : "Add to Favorites"}</span>
          </button>
          {live.UserData?.InWatchlist != null && item.Type !== "Episode" ? (
            <WatchlistCardRow session={session} item={live} inWatchlist={live.UserData.InWatchlist} onDone={() => { setMenuOpen(false); requestAnimationFrame(() => cardRef.current?.focus({ preventScroll: true })); }} />
          ) : null}
        </div>
      </div>,
      document.body
    ) : null}
    </div>
  );
}
