import { useEffect, useRef, useState } from "react";
import { backdropUrl, getCatalogItem, getSimilarItems, imageUrl, isFavorite, isInWatchlist, mediaLogoUrl, setFavorite, setWatched, setWatchlist } from "../api/silo";
import { CastSection, FactsSection, TrailersSection, factsFor, useDetailExtras } from "../components/DetailSections";
import { PlaybackOptionsDialog, PlaybackSummary, useWatchDetail } from "../components/PlaybackOptions";
import { GearIcon, MoreIcon, PlayIcon, RestartIcon, WatchlistIcon } from "../components/icons";
import { MediaRail } from "../components/MediaRail";
import { ResumeProgress } from "../components/ResumeProgress";
import type { PlaybackChoices } from "../api/playback";
import type { DetailPerson, DetailTrailer } from "../api/silo";
import type { Session, SiloItem } from "../types";
import { hidesEpisodeImage, hidesEpisodeOverview, useEpisodeSpoilerPreferences } from "../core/episodeSpoilers";

type Props = {
  session: Session;
  item: SiloItem;
  onPlay: (startPosition: number | undefined, choices: PlaybackChoices) => void;
  onOpen: (item: SiloItem) => void;
  restoreCastIndex?: number;
  onOpenPerson: (person: DetailPerson, index: number) => void;
  onPlayExtra: (trailer: DetailTrailer) => void;
};

function clock(seconds: number) {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

function audiobookDuration(detail: SiloItem) {
  const seconds = detail.AudiobookDurationSeconds ?? (detail.RunTimeTicks ? detail.RunTimeTicks / 10_000_000 : undefined);
  if (!seconds || seconds <= 0) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function runtimeLabel(minutes?: number) {
  if (!minutes || minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? (rest ? `${hours}h ${rest}m` : `${hours}h`) : `${rest}m`;
}

function typeLabel(type?: string) {
  if (type === "Movie") return "Movie";
  if (type === "AudioBook") return "Audiobook";
  if (type === "Episode") return "Episode";
  return type ?? "";
}

export function DetailsScreen({ session, item, onPlay, onOpen, restoreCastIndex, onOpenPerson, onPlayExtra }: Props) {
  const [detail, setDetail] = useState(item);
  const [favorite, updateFavorite] = useState(false);
  const [watchlist, updateWatchlist] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [similar, setSimilar] = useState<SiloItem[]>([]);
  const [actionError, setActionError] = useState("");
  const [positionCleared, setPositionCleared] = useState(false);
  useEffect(() => setPositionCleared(false), [item.Id]);
  const extras = useDetailExtras(session, item.Id);
  const spoilerPreferences = useEpisodeSpoilerPreferences(session);
  const watchDetail = useWatchDetail(session, item.Type === "Movie" || item.Type === "Episode" ? item : undefined);
  const hasPlaybackSummary = item.Type === "Movie" || item.Type === "Episode";
  const [choices, setChoices] = useState<PlaybackChoices>({});
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsRef = useRef<HTMLButtonElement>(null);
  useEffect(() => setChoices({}), [item.Id]);
  const playRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const moreFirstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    setDetail(item);
    getCatalogItem(session, item.Id).then(next => {
      if (!alive) return;
      // Catalog items carry an explicit `UserData: undefined` when they have no user state;
      // spreading that over the rail item would wipe its resume position.
      const defined = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined));
      setDetail({ ...item, ...defined, UserData: { ...item.UserData, ...next.UserData } });
    }).catch(() => undefined);
    Promise.all([isFavorite(session, item.Id), isInWatchlist(session, item.Id)])
      .then(([nextFavorite, nextWatchlist]) => {
        if (!alive) return;
        updateFavorite(nextFavorite);
        updateWatchlist(nextWatchlist);
      })
      .catch(() => {});
    getSimilarItems(session, item.Id).then(items => { if (alive) setSimilar(items); }).catch(() => undefined);
    return () => { alive = false; };
  }, [session, item]);

  useEffect(() => {
    if (restoreCastIndex != null) return;
    const frame = requestAnimationFrame(() => playRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [item.Id]);

  useEffect(() => {
    if (moreOpen) requestAnimationFrame(() => moreFirstRef.current?.focus());
  }, [moreOpen]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (!["Escape", "Backspace", "Back", "GoBack", "BrowserBack"].includes(event.key) && event.keyCode !== 461 && event.keyCode !== 10009) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeMore();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [moreOpen]);

  function closeMore() {
    setMoreOpen(false);
    requestAnimationFrame(() => moreRef.current?.focus({ preventScroll: true }));
  }

  async function toggleFavorite() {
    const next = !favorite;
    updateFavorite(next);
    setActionError("");
    closeMore();
    try { await setFavorite(session, detail.Id, next); }
    catch (error) { updateFavorite(!next); setActionError(error instanceof Error ? error.message : "Favorite failed"); }
  }

  async function toggleWatchlist() {
    const next = !watchlist;
    updateWatchlist(next);
    setActionError("");
    try { await setWatchlist(session, detail.Id, next); }
    catch (error) { updateWatchlist(!next); setActionError(error instanceof Error ? error.message : "Watchlist failed"); }
  }

  const watched = detail.UserData?.Played === true;

  async function toggleWatched() {
    const next = !watched;
    setActionError("");
    closeMore();
    try {
      await setWatched(session, detail.Id, next);
      if (next) setPositionCleared(true);
      setDetail(current => ({
        ...current,
        UserData: { ...current.UserData, Played: next, PlaybackPositionTicks: next ? 0 : current.UserData?.PlaybackPositionTicks, PlayedPercentage: next ? 0 : current.UserData?.PlayedPercentage }
      }));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not update watched state");
    }
  }

  // /watch is the authoritative resume position (the player starts from it), so prefer it over
  // whatever the rail or catalog item happened to carry. Marking watched clears it locally.
  const watchPosition = watchDetail?.user_data?.position_seconds;
  const position = positionCleared
    ? 0
    : watchPosition ?? (detail.UserData?.PlaybackPositionTicks ?? 0) / 10_000_000;
  const duration = (detail.RunTimeTicks ?? 0) / 10_000_000
    || (watchDetail?.versions.find(version => version.duration)?.duration ?? 0);
  const canResume = position > 30 && duration > 0 && position < duration - 5;
  const audiobook = detail.Type === "AudioBook";
  const audiobookFinished = audiobook && (detail.UserData?.Played === true || duration > 0 && position > 0 && position >= duration - 5);
  const audiobookStartPosition = canResume ? position : audiobookFinished ? 0 : undefined;
  const playPosition = audiobook ? audiobookStartPosition : canResume ? position : 0;
  const audiobookPlayLabel = canResume ? `Resume ${clock(position)}` : audiobookFinished ? "Play Again" : "Play";
  const logo = mediaLogoUrl(session, detail);
  const [logoFailed, setLogoFailed] = useState(false);
  const [activeButton, setActiveButton] = useState<string | null>(null);
  useEffect(() => setLogoFailed(false), [detail.LogoUrl]);
  const rating = detail.ImdbRating ?? detail.TmdbRating;
  const facts = [detail.ProductionYear ? String(detail.ProductionYear) : "", runtimeLabel(detail.RuntimeMinutes), rating ? `★ ${rating.toFixed(1)}` : ""].filter(Boolean);
  const directorCredit = extras?.crew.filter(member => member.role?.toLowerCase() === "director").slice(0, 2).map(member => member.name).filter(Boolean).join(", ") || "";
  const tokens = [typeLabel(detail.Type), ...(detail.Genres ?? []).slice(0, 2)].filter(Boolean);
  const relatedTitle = detail.Type === "Movie" ? "Related Movies" : "Related";
  const hideEpisodeOverview = hidesEpisodeOverview(detail, spoilerPreferences);
  const hideEpisodeBackdrop = hidesEpisodeImage(detail, spoilerPreferences, detail.BackdropIsEpisodeStill);

  return (
    <main className={`details-shell${audiobook ? " audiobook-detail-shell" : ""}`}>
      <div
        className={`details-backdrop${hideEpisodeBackdrop ? " spoiler-hidden-image" : ""}`}
        style={{ backgroundImage: `url("${audiobook ? imageUrl(session, detail) : backdropUrl(session, detail)}")` }}
      />
      <div className="details-scrim" />
      <div className={`details-content${audiobook ? " audiobook-detail-content" : ""}`}>
        {audiobook ? <img className="audiobook-detail-poster" src={imageUrl(session, detail) || ""} alt="" /> : null}
        <div className={audiobook ? "audiobook-detail-copy" : undefined}>
        {audiobook ? <div className="audiobook-eyebrow">AUDIOBOOK</div> : null}
        {audiobook ? <h1>{detail.Name}</h1> : logo && !logoFailed ? (
          <img className="details-logo" src={logo} alt={detail.Name} onError={() => setLogoFailed(true)} />
        ) : <h1>{detail.Name}</h1>}
        {!audiobook ? <div className="details-facts">
          {detail.ContentRating ? <span className="details-rating-chip">{detail.ContentRating}</span> : null}
          {tokens.map(token => <span key={token}>{token}</span>)}
          {facts.map(fact => <span key={fact}>{fact}</span>)}
          {canResume ? <ResumeProgress position={position} duration={duration} /> : null}
        </div> : null}
        {!audiobook && extras?.tagline ? <div className="details-tokens">{extras.tagline}</div> : null}
        {audiobook ? <div className="audiobook-detail-metadata">{[detail.AudiobookAuthorNames ?? detail.Author, (detail.AudiobookNarratorNames ?? detail.Narrator) ? `Narrated by ${detail.AudiobookNarratorNames ?? detail.Narrator}` : "", audiobookDuration(detail)].filter(Boolean).join("  ")}</div> : null}
        {audiobook && detail.Publisher ? <div className="audiobook-detail-publisher">{detail.Publisher}</div> : null}
        {detail.Overview && !hideEpisodeOverview ? <p className={`details-overview${audiobook ? " audiobook-detail-overview" : ""}`}>{detail.Overview}</p> : null}
        {!audiobook && (detail.Author || detail.Narrator) ? (
          <div className="details-credit">{[detail.Author, detail.Narrator ? `Narrated by ${detail.Narrator}` : ""].filter(Boolean).join(" · ")}</div>
        ) : null}
        {detail.Type !== "AudioBook" && directorCredit ? <div className="details-credit">{`Directed by ${directorCredit}`}</div> : null}
        {hasPlaybackSummary ? <PlaybackSummary detail={watchDetail} choices={choices} /> : null}
        <div className="details-actions">
          <button ref={playRef} type="button" data-tv-focusable="true" className={`tv-button ${activeButton === null || activeButton === "play" ? "pin-open" : ""}`} aria-label={audiobook ? audiobookPlayLabel : canResume ? "Resume" : "Play"} onFocus={() => setActiveButton("play")} onClick={() => onPlay(playPosition, choices)}>
            <PlayIcon />
            <span className="tv-button-label">{audiobook ? audiobookPlayLabel : canResume ? "Resume" : "Play"}</span>
          </button>
          {canResume || audiobook ? (
            <button type="button" data-tv-focusable="true" className="tv-button secondary" aria-label="Start Over" onFocus={() => setActiveButton("start")} onClick={() => onPlay(0, choices)}>
              <RestartIcon />
              <span className="tv-button-label">Start Over</span>
            </button>
          ) : null}
          {!audiobook ? <><button type="button" data-tv-focusable="true" className="tv-button secondary" aria-label={watchlist ? "In Watchlist" : "Watchlist"} onFocus={() => setActiveButton("watchlist")} onClick={() => void toggleWatchlist()}>
            <WatchlistIcon active={watchlist} />
            <span className="tv-button-label">{watchlist ? "In Watchlist" : "Watchlist"}</span>
          </button>
          {watchDetail ? (
            <button ref={optionsRef} type="button" data-tv-focusable="true" className="tv-button secondary" aria-label="Options" aria-haspopup="dialog" onFocus={() => setActiveButton("options")} onClick={() => setOptionsOpen(true)}>
              <GearIcon />
              <span className="tv-button-label">Options</span>
            </button>
          ) : null}
          <button ref={moreRef} type="button" data-tv-focusable="true" className="tv-button secondary" aria-label="More" aria-haspopup="dialog" onFocus={() => setActiveButton("more")} onClick={() => setMoreOpen(true)}>
            <MoreIcon />
            <span className="tv-button-label">More</span>
          </button> </> : null}
        </div>
        {actionError ? <div className="error">{actionError}</div> : null}
        </div>
      </div>
      <div className="details-related">
        {detail.Type !== "AudioBook" && extras ? <CastSection cast={extras.cast} restoreIndex={restoreCastIndex} onOpen={onOpenPerson} /> : null}
        {extras ? <TrailersSection trailers={extras.trailers} onPlayLocal={onPlayExtra} /> : null}
        {similar.length ? <MediaRail rail={{ id: "similar", title: relatedTitle, items: similar }} session={session} onOpen={onOpen} slide /> : null}
        <FactsSection facts={factsFor(extras)} />
      </div>
      {optionsOpen ? (
        <PlaybackOptionsDialog
          session={session}
          detail={watchDetail}
          choices={choices}
          onChange={setChoices}
          onClose={() => { setOptionsOpen(false); requestAnimationFrame(() => optionsRef.current?.focus({ preventScroll: true })); }}
        />
      ) : null}
      {moreOpen ? (
        <div className="details-more-scrim" data-modal="true" onClick={closeMore}>
          <div className="details-more" role="dialog" aria-label="More Actions" onClick={event => event.stopPropagation()}>
            <h2>More Actions</h2>
            <button ref={moreFirstRef} type="button" data-tv-focusable="true" className="browse-panel-row" onClick={() => void toggleFavorite()}>
              <span>{favorite ? "Remove from Favorites" : "Add to Favorites"}</span>
            </button>
            <button type="button" data-tv-focusable="true" className="browse-panel-row" onClick={() => void toggleWatched()}>
              <span>{watched ? `Mark ${detail.Type === "Episode" ? "Episode" : detail.Type === "Movie" ? "Movie" : "Item"} Unwatched` : `Mark ${detail.Type === "Episode" ? "Episode" : detail.Type === "Movie" ? "Movie" : "Item"} Watched`}</span>
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
