import { useEffect, useState } from "react";
import { imageUrl, isFavorite, isInWatchlist, setFavorite, setWatchlist } from "../api/silo";
import { TvButton } from "../components/TvButton";
import type { Session, SiloItem } from "../types";

type Props = {
  session: Session;
  item: SiloItem;
  onPlay: () => void;
  onBack: () => void;
};

export function DetailsScreen({ session, item, onPlay, onBack }: Props) {
  const [favorite, updateFavorite] = useState(false);
  const [watchlist, updateWatchlist] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.all([isFavorite(session, item.Id), isInWatchlist(session, item.Id)])
      .then(([nextFavorite, nextWatchlist]) => {
        if (!alive) return;
        updateFavorite(nextFavorite);
        updateWatchlist(nextWatchlist);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [session, item.Id]);

  async function toggleFavorite() {
    const next = !favorite;
    updateFavorite(next);
    setActionError("");
    try { await setFavorite(session, item.Id, next); }
    catch (error) { updateFavorite(!next); setActionError(error instanceof Error ? error.message : "Favorite failed"); }
  }

  async function toggleWatchlist() {
    const next = !watchlist;
    updateWatchlist(next);
    setActionError("");
    try { await setWatchlist(session, item.Id, next); }
    catch (error) { updateWatchlist(!next); setActionError(error instanceof Error ? error.message : "Watchlist failed"); }
  }

  return (
    <main className="details-shell">
      <TvButton className="secondary top-back" onClick={onBack}>‹ Back</TvButton>
      <div
        className="details-backdrop"
        style={{ backgroundImage: `url("${imageUrl(session, item)}")` }}
      />
      <div className="details-scrim" />
      <div className="details-content">
        <div className="eyebrow">{item.Type ?? "Media"}</div>
        <h1>{item.Name}</h1>
        {item.ProductionYear ? <div className="details-year">{item.ProductionYear}</div> : null}
        {item.Overview ? <p className="details-overview">{item.Overview}</p> : null}
        <div className="details-actions">
          <TvButton onClick={onPlay}>▶ Play</TvButton>
          <TvButton className="secondary" onClick={toggleFavorite}>{favorite ? "♥ Favorited" : "♡ Favorite"}</TvButton>
          <TvButton className="secondary" onClick={toggleWatchlist}>{watchlist ? "▣ In Watchlist" : "▢ Watchlist"}</TvButton>
        </div>
        {actionError ? <div className="error">{actionError}</div> : null}
      </div>
    </main>
  );
}
