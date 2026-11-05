import { useEffect, useMemo, useRef, useState } from "react";
import { backdropUrl, getCatalogItem, getEpisodes, getSeasons, getShuffleCapability, getSimilarItems, imageUrl, isFavorite, isInWatchlist, mediaLogoUrl, setFavorite, setWatched, setWatchlist } from "../api/silo";
import { CastSection, FactsSection, TrailersSection, factsFor, useDetailExtras } from "../components/DetailSections";
import { PlaybackOptionsDialog, PlaybackSummary, useWatchDetail } from "../components/PlaybackOptions";
import { GearIcon, MoreIcon, PlayIcon, RestartIcon, WatchlistIcon } from "../components/icons";
import { MediaRail } from "../components/MediaRail";
import { ArtworkImage } from "../components/ArtworkImage";
import type { PlaybackChoices, WatchDetail } from "../api/playback";
import type { DetailPerson, DetailTrailer } from "../api/silo";
import type { Session, SiloItem } from "../types";
import { applyWatchedState, publishWatchState } from "../core/watchState";
import { LoadingState } from "../components/LoadingState";
import { hidesEpisodeImage, hidesEpisodeOverview, useEpisodeSpoilerPreferences } from "../core/episodeSpoilers";

type Props = {
  session: Session;
  series: SiloItem;
  initialEpisode?: SiloItem;
  onPlayEpisode: (episode: SiloItem, startPosition: number, choices?: PlaybackChoices) => void;
  onShuffle: (kind: string, id: string | number) => Promise<void>;
  onOpen: (item: SiloItem) => void;
  restoreCastIndex?: number;
  onOpenPerson: (person: DetailPerson, index: number) => void;
  onPlayExtra: (trailer: DetailTrailer) => void;
  onBack: () => void;
};


function seasonNumber(season: SiloItem) {
  return season.IndexNumber ?? season.ParentIndexNumber ?? 0;
}

function seasonLabel(season: SiloItem) {
  const number = seasonNumber(season);
  if (number === 0) return "Specials";
  return season.Name && season.Name !== "Untitled" ? season.Name : `Season ${number}`;
}

function code(episode: SiloItem) {
  return `S${episode.ParentIndexNumber ?? 0}:E${episode.IndexNumber ?? 0}`;
}

function captionTitle(episode: SiloItem) {
  const season = String(episode.ParentIndexNumber ?? 0).padStart(2, "0");
  const number = String(episode.IndexNumber ?? 0).padStart(2, "0");
  return `S${season}E${number} · ${episode.Name}`;
}

function airDate(episode: SiloItem) {
  const raw = episode.AirDate ?? episode.ReleaseDate;
  if (!raw) return "";
  const date = new Date(raw.length <= 10 ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function runtime(minutes?: number) {
  if (!minutes || minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? (rest ? `${hours}h ${rest}m` : `${hours}h`) : `${rest} min`;
}

function clock(seconds: number) {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

function resumePosition(episode?: SiloItem) {
  if (!episode) return 0;
  const position = (episode.UserData?.PlaybackPositionTicks ?? 0) / 10_000_000;
  const duration = (episode.RunTimeTicks ?? 0) / 10_000_000;
  return position > 30 && duration > 0 && position < duration - 5 ? position : 0;
}

function isInProgress(episode: SiloItem) {
  return resumePosition(episode) > 0 || ((episode.UserData?.PlayedPercentage ?? 0) > 0 && episode.UserData?.Played !== true);
}

function isWatched(episode: SiloItem) {
  return episode.UserData?.Played === true;
}

function resolveNextUp(episodes: SiloItem[]) {
  return episodes.find(isInProgress) ?? episodes.find(episode => !isWatched(episode)) ?? episodes[0];
}

export function SeriesScreen({ session, series, initialEpisode, onPlayEpisode, onShuffle, onOpen, restoreCastIndex, onOpenPerson, onPlayExtra, onBack }: Props) {
  const [show, setShow] = useState(series);
  const [seasons, setSeasons] = useState<SiloItem[]>([]);
  const [episodesBySeason, setEpisodesBySeason] = useState<Record<number, SiloItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<string>("");
  const [activeButton, setActiveButton] = useState<string | null>(null);
  const [rememberedEpisodeId, setRememberedEpisodeId] = useState<string | undefined>();
  const [focusedEpisodeId, setFocusedEpisodeId] = useState<string | undefined>();
  const [favorite, setFavoriteState] = useState(false);
  const [watchlist, setWatchlistState] = useState(false);
  const [similar, setSimilar] = useState<SiloItem[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [shuffleKinds, setShuffleKinds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [logoFailed, setLogoFailed] = useState(false);
  const extras = useDetailExtras(session, series.Id);
  const spoilerPreferences = useEpisodeSpoilerPreferences(session);
  const [choices, setChoices] = useState<PlaybackChoices>({});
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsRef = useRef<HTMLButtonElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const moreFirstRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const entryHandled = useRef(false);

  useEffect(() => {
    let alive = true;
    getCatalogItem(session, series.Id).then(next => { if (alive) setShow({ ...series, ...next }); }).catch(() => undefined);
    Promise.all([isFavorite(session, series.Id), isInWatchlist(session, series.Id)])
      .then(([nextFavorite, nextWatchlist]) => {
        if (!alive) return;
        setFavoriteState(nextFavorite);
        setWatchlistState(nextWatchlist);
      })
      .catch(() => undefined);
    getSimilarItems(session, series.Id).then(items => { if (alive) setSimilar(items); }).catch(() => undefined);
    getShuffleCapability(session).then(result => { if (alive) setShuffleKinds(result.available ? result.scopeKinds : []); }).catch(() => undefined);
    return () => { alive = false; };
  }, [session, series.Id]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    getSeasons(session, series.Id)
      .then(async items => {
        const loaded = await Promise.all(items.map(season =>
          getEpisodes(session, series.Id, seasonNumber(season)).then(episodes => [seasonNumber(season), episodes] as const)
        ));
        if (!alive) return;
        setSeasons(items);
        setEpisodesBySeason(Object.fromEntries(loaded));
      })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "Could not load episodes."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [session, series.Id, reload]);

  const allEpisodes = useMemo(
    () => seasons.flatMap(season => episodesBySeason[seasonNumber(season)] ?? []),
    [seasons, episodesBySeason]
  );
  const nextUp = useMemo(() => resolveNextUp(allEpisodes), [allEpisodes]);
  const nextUpRef = useRef<SiloItem | undefined>(undefined);

  useEffect(() => {
    if (loading || entryHandled.current || !seasons.length) return;
    if (restoreCastIndex != null) { entryHandled.current = true; return; }
    entryHandled.current = true;
    nextUpRef.current = initialEpisode ? undefined : nextUp;
    const target = initialEpisode ? allEpisodes.find(episode => episode.Id === initialEpisode.Id) : undefined;
    if (target && target.ParentIndexNumber != null) {
      setMode(String(target.ParentIndexNumber));
      setFocusedEpisodeId(target.Id);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const rail = railRef.current;
        const card = rail?.querySelector<HTMLElement>(`[data-episode-id="${CSS.escape(target.Id)}"]`);
        if (rail && card) {
          const railRect = rail.getBoundingClientRect();
          const cardRect = card.getBoundingClientRect();
          rail.scrollLeft = Math.max(0, rail.scrollLeft + cardRect.left - railRect.left - (rail.clientWidth - cardRect.width) / 2);
        }
        if (card) setRememberedEpisodeId(target.Id);
        (card ?? playRef.current)?.focus({ preventScroll: true });
      }));
    } else {
      playRef.current?.focus({ preventScroll: true });
    }
  }, [loading, seasons, allEpisodes, initialEpisode, nextUp]);

  useEffect(() => {
    if (!moreOpen) return;
    requestAnimationFrame(() => moreFirstRef.current?.focus());
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

  const activeSeason = seasons.find(season => String(seasonNumber(season)) === mode)
    ?? (initialEpisode
      ? seasons.find(season => seasonNumber(season) === (initialEpisode.ParentIndexNumber ?? 0))
      : seasons.find(season => seasonNumber(season) > 0))
    ?? seasons[0];
  const railSeasonNumber = activeSeason ? seasonNumber(activeSeason) : 0;
  const railEpisodes = episodesBySeason[railSeasonNumber] ?? [];
  const focusedEpisode = allEpisodes.find(episode => episode.Id === focusedEpisodeId && episode.ParentIndexNumber === railSeasonNumber);
  const highlightedId = focusedEpisodeId ?? nextUpRef.current?.Id;
  const target = focusedEpisode ?? (initialEpisode && railEpisodes.some(episode => episode.Id === initialEpisode.Id) ? initialEpisode : railEpisodes[0]);
  const resume = resumePosition(target);
  const playLabel = target ? `${resume > 0 ? "Resume" : "Play"} ${code(target)}${resume > 0 ? ` ${clock(resume)}` : ""}` : "Play";
  const watchDetail = useWatchDetail(session, target);
  // Keep the last loaded detail on screen while the next episode's detail
  // resolves so the Options button and summary row hold their positions
  // instead of disappearing per episode change (Android retains the same way).
  const lastDetailRef = useRef<WatchDetail | null>(null);
  if (watchDetail) lastDetailRef.current = watchDetail;
  const displayDetail = lastDetailRef.current;
  useEffect(() => setChoices({}), [target?.Id]);
  const logo = mediaLogoUrl(session, show);
  const rating = show.ImdbRating ?? show.TmdbRating;
  const seasonCount = show.SeasonCount ?? seasons.filter(season => seasonNumber(season) > 0).length;
  const synopsis = focusedEpisode
    ? hidesEpisodeOverview(focusedEpisode, spoilerPreferences) ? "" : [focusedEpisode.Name, focusedEpisode.Overview ?? ""].filter(Boolean).join(" · ")
    : show.Overview ?? "";
  const metaTokens = [
    focusedEpisode
      ? [focusedEpisode.ParentIndexNumber === 0 ? "Specials" : `Season ${focusedEpisode.ParentIndexNumber}`, `Episode ${focusedEpisode.IndexNumber ?? ""}`].filter(Boolean).join(" · ")
      : ["TV Show", ...(show.Genres ?? []).slice(0, 2)].filter(Boolean).join(" · "),
    focusedEpisode ? [airDate(focusedEpisode), runtime(focusedEpisode.RuntimeMinutes)].filter(Boolean).join(" · ")
      : [show.ProductionYear ? String(show.ProductionYear) : "", seasonCount ? `${seasonCount} ${seasonCount === 1 ? "Season" : "Seasons"}` : ""].filter(Boolean).join(" · ")
  ].filter(Boolean);
  const heroBackdrop = backdropUrl(session, show);

  function selectMode(next: string) {
    if (next === mode) return;
    setMode(next);
    setFocusedEpisodeId(undefined);
    requestAnimationFrame(() => {
      if (railRef.current) railRef.current.scrollLeft = 0;
    });
  }

  async function toggleWatchlist() {
    const next = !watchlist;
    setWatchlistState(next);
    try { await setWatchlist(session, series.Id, next); }
    catch (cause) { setWatchlistState(!next); setError(cause instanceof Error ? cause.message : "Watchlist failed"); }
  }

  async function toggleFavorite() {
    const next = !favorite;
    setFavoriteState(next);
    closeMore();
    try { await setFavorite(session, series.Id, next); }
    catch (cause) { setFavoriteState(!next); setError(cause instanceof Error ? cause.message : "Favorite failed"); }
  }

  async function markWatched(id: string, watched: boolean) {
    closeMore();
    try {
      await setWatched(session, id, watched);
      if (id === target?.Id) {
        setEpisodesBySeason(current => {
          const next = { ...current };
          for (const key of Object.keys(next)) {
            next[Number(key)] = next[Number(key)].map(episode => {
              if (episode.Id !== id) return episode;
              const updated = applyWatchedState(episode, watched);
              publishWatchState(updated);
              return updated;
            });
          }
          return next;
        });
      } else {
        setReload(value => value + 1);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update watched state");
    }
  }

  async function shuffle(kind: string, id: string) {
    closeMore();
    try { await onShuffle(kind, id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start shuffle playback."); }
  }

  const seriesWatched = allEpisodes.length > 0 && allEpisodes.every(isWatched);
  const seasonWatched = railEpisodes.length > 0 && railEpisodes.every(isWatched);
  const canShuffleSeason = activeSeason && railEpisodes.length >= 2 && shuffleKinds.includes("season");

  return (
    <main className="series-screen" data-last-episode={rememberedEpisodeId ?? ""}>
      <div className="series-hero" style={{ backgroundImage: heroBackdrop ? `url("${heroBackdrop}")` : undefined }}>
        <div className="series-hero-scrim" />
        <div className="series-copy">
          {logo && !logoFailed ? (
            <img className="details-logo" src={logo} alt={show.Name} onError={() => setLogoFailed(true)} />
          ) : <h1>{show.Name}</h1>}
          <div className="details-facts">
            {show.ContentRating ? <span className="details-rating-chip">{show.ContentRating}</span> : null}
            {metaTokens.map(token => <span key={token}>{token}</span>)}
            {rating ? <span>{`★ ${rating.toFixed(1)}`}</span> : null}
          </div>
          <p className="series-overview">{synopsis}</p>
          {extras?.cast.length ? <div className="details-credit">{`Starring ${extras.cast.slice(0, 3).map(member => member.name).join(", ")}`}</div> : null}
          <PlaybackSummary detail={watchDetail} choices={choices} />
          <div className="details-actions">
            <button ref={playRef} type="button" data-tv-focusable="true" className={`tv-button series-play ${activeButton === null || activeButton === "play" ? "pin-open" : ""}`} disabled={!target}
              aria-label={playLabel} onFocus={() => setActiveButton("play")} onClick={() => target && onPlayEpisode(target, resume, choices)}>
              <PlayIcon />
              <span className="tv-button-label">{playLabel}</span>
            </button>
            {resume > 0 && target ? (
              <button type="button" data-tv-focusable="true" className="tv-button secondary" aria-label="Start Over" onFocus={() => setActiveButton("start")} onClick={() => onPlayEpisode(target, 0, choices)}>
                <RestartIcon />
                <span className="tv-button-label">Start Over</span>
              </button>
            ) : null}
            <button type="button" data-tv-focusable="true" className="tv-button secondary" aria-label={watchlist ? "In Watchlist" : "Watchlist"} onFocus={() => setActiveButton("watchlist")} onClick={() => void toggleWatchlist()}>
              <WatchlistIcon active={watchlist} />
              <span className="tv-button-label">{watchlist ? "In Watchlist" : "Watchlist"}</span>
            </button>
            {displayDetail ? (
              <button ref={optionsRef} type="button" data-tv-focusable="true" className="tv-button secondary" aria-label="Options" aria-haspopup="dialog" onFocus={() => setActiveButton("options")} onClick={() => setOptionsOpen(true)}>
                <GearIcon />
                <span className="tv-button-label">Options</span>
              </button>
            ) : null}
            <button ref={moreRef} type="button" data-tv-focusable="true" className="tv-button secondary" aria-label="More" aria-haspopup="dialog" onFocus={() => setActiveButton("more")} onClick={() => setMoreOpen(true)}>
              <MoreIcon />
              <span className="tv-button-label">More</span>
            </button>
          </div>
          {error ? <div className="error">{error}</div> : null}
        </div>
      </div>

      <section className="series-body">
        <div className="season-tabs" role="tablist">
          {seasons.map(season => {
            const id = String(seasonNumber(season));
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={railSeasonNumber === seasonNumber(season)}
                data-tv-focusable="true"
                data-season-tab={id}
                className={`season-tab ${railSeasonNumber === seasonNumber(season) ? "active" : ""}`}
                onFocus={() => selectMode(id)}
                onClick={() => selectMode(id)}
              >
                {seasonLabel(season)}
              </button>
            );
          })}
        </div>
        <div className="episode-rail" ref={railRef}>
          {loading ? <LoadingState label="Loading episodes" /> : railEpisodes.length ? railEpisodes.map(episode => (
            <EpisodeCard key={episode.Id} session={session} episode={episode} current={highlightedId === episode.Id}
              onFocus={() => { setActiveButton(null); setMode(String(episode.ParentIndexNumber ?? 0)); setFocusedEpisodeId(episode.Id); setRememberedEpisodeId(episode.Id); }}
              onOpen={() => onPlayEpisode(episode, resumePosition(episode))}
              onSetWatched={(changed, next) => void markWatched(changed.Id, next)}
              hideImage={hidesEpisodeImage(episode, spoilerPreferences, episode.PosterIsEpisodeStill)} />
          )) : <div className="screen-state">No episodes available</div>}
        </div>
        <div className="series-related">
          {extras ? <CastSection cast={extras.cast} restoreIndex={restoreCastIndex} onOpen={onOpenPerson} /> : null}
          {extras ? <TrailersSection trailers={extras.trailers} onPlayLocal={onPlayExtra} /> : null}
          {similar.length ? <MediaRail rail={{ id: "similar", title: "Recommended Series", items: similar }} session={session} onOpen={onOpen} /> : null}
          <FactsSection facts={factsFor(extras)} />
        </div>
      </section>

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
            {shuffleKinds.includes("series") ? (
              <MoreRow innerRef={moreFirstRef} onClick={() => void shuffle("series", series.Id)}>Shuffle Series</MoreRow>
            ) : null}
            {canShuffleSeason && activeSeason ? (
              <MoreRow innerRef={shuffleKinds.includes("series") ? undefined : moreFirstRef} onClick={() => void shuffle("season", activeSeason.Id)}>
                {`Shuffle ${seasonLabel(activeSeason)}`}
              </MoreRow>
            ) : null}
            <MoreRow innerRef={!shuffleKinds.includes("series") && !canShuffleSeason ? moreFirstRef : undefined} onClick={() => void toggleFavorite()}>
              {favorite ? "Remove from Favorites" : "Add to Favorites"}
            </MoreRow>
            <MoreRow onClick={() => target && void markWatched(target.Id, !isWatched(target))}>
              {target ? (isWatched(target) ? "Mark Episode Unwatched" : "Mark Episode Watched") : "Mark Episode Watched"}
            </MoreRow>
            <MoreRow onClick={() => void markWatched(series.Id, !seriesWatched)}>
              {seriesWatched ? "Mark Series Unwatched" : "Mark Series Watched"}
            </MoreRow>
            {activeSeason && railEpisodes.length ? (
              <MoreRow onClick={() => void markWatched(activeSeason.Id, !seasonWatched)}>
                {`Mark ${seasonLabel(activeSeason)} ${seasonWatched ? "Unwatched" : "Watched"}`}
              </MoreRow>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}

function MoreRow({ children, onClick, innerRef }: { children: string; onClick: () => void; innerRef?: React.Ref<HTMLButtonElement> }) {
  return (
    <button ref={innerRef} type="button" data-tv-focusable="true" className="browse-panel-row" onClick={onClick}>
      <span>{children}</span>
    </button>
  );
}

function EpisodeCard({ session, episode, current, onFocus, onOpen, onSetWatched, hideImage }: {
  session: Session;
  episode: SiloItem;
  current: boolean;
  onFocus: () => void;
  onOpen: () => void;
  onSetWatched: (episode: SiloItem, watched: boolean) => void;
  hideImage: boolean;
}) {
  const image = imageUrl(session, episode);
  const progress = Math.max(0, Math.min(100, episode.UserData?.PlayedPercentage ?? 0));
  const watched = isWatched(episode);
  const meta = [airDate(episode), runtime(episode.RuntimeMinutes)].filter(Boolean).join(" · ");
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuFavorite, setMenuFavorite] = useState(false);
  const cardRef = useRef<HTMLButtonElement>(null);
  const menuFirstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onOpenMenu = (event: Event) => {
      if (!(event.target instanceof HTMLElement) || !event.target.closest(".episode-tile") || event.target !== cardRef.current && !cardRef.current?.contains(event.target)) return;
      setMenuOpen(true);
    };
    window.addEventListener("silo:open-card-menu", onOpenMenu);
    return () => window.removeEventListener("silo:open-card-menu", onOpenMenu);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    let alive = true;
    isFavorite(session, episode.Id).then(next => { if (alive) setMenuFavorite(next); }).catch(() => undefined);
    requestAnimationFrame(() => menuFirstRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (!["Escape", "Backspace", "Back", "GoBack", "BrowserBack"].includes(event.key) && event.keyCode !== 461 && event.keyCode !== 10009) return;
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
  }, [menuOpen, session, episode.Id]);

  return (
    <div className="episode-tile-wrap">
    <button
      ref={cardRef}
      type="button"
      data-tv-focusable="true"
      data-menu-context="true"
      data-episode-id={episode.Id}
      className={`episode-tile ${current ? "selected" : ""} ${watched ? "watched" : ""}`}
      onFocus={onFocus}
      onClick={onOpen}
    >
      <div className="episode-tile-art">
        <ArtworkImage url={image} thumbhash={episode.BackdropThumbhash ?? episode.PosterThumbhash} kind="Tv" hideImage={hideImage} width={640} height={360} />
        {watched ? <span className="media-card-watched-check" aria-label="Watched">✓</span> : null}
        {!watched && progress > 0 && progress < 100 ? <i><span style={{ width: `${progress}%` }} /></i> : null}
      </div>
      <strong>{captionTitle(episode)}</strong>
      <small>{meta || " "}</small>
    </button>
    {menuOpen ? (
      <div className="details-more-scrim" data-modal="true" onClick={() => { setMenuOpen(false); requestAnimationFrame(() => cardRef.current?.focus({ preventScroll: true })); }}>
        <div className="details-more card-menu" role="dialog" aria-label={`${episode.Name} Actions`} onClick={event => event.stopPropagation()}>
          <button ref={menuFirstRef} type="button" data-tv-focusable="true" className="browse-panel-row" onClick={onOpen}>
            <span>Play</span>
          </button>
          <button type="button" data-tv-focusable="true" className="browse-panel-row" onClick={() => { setMenuOpen(false); onSetWatched(episode, !watched); requestAnimationFrame(() => cardRef.current?.focus({ preventScroll: true })); }}>
            <span>{watched ? "Mark Unwatched" : "Mark Watched"}</span>
          </button>
          <button type="button" data-tv-focusable="true" className="browse-panel-row" onClick={() => {
            const next = !menuFavorite;
            setMenuFavorite(next);
            void setFavorite(session, episode.Id, next).catch(() => setMenuFavorite(!next));
            setMenuOpen(false);
            requestAnimationFrame(() => cardRef.current?.focus({ preventScroll: true }));
          }}>
            <span>{menuFavorite ? "Remove from Favorites" : "Add to Favorites"}</span>
          </button>
        </div>
      </div>
    ) : null}
    </div>
  );
}
