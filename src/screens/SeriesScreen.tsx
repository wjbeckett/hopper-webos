import { useEffect, useRef, useState } from "react";
import { backdropUrl, getCatalogItem, getEpisodes, getSeasons, imageUrl } from "../api/silo";
import { TvButton } from "../components/TvButton";
import type { Session, SiloItem } from "../types";

export function SeriesScreen({ session, series, initialEpisode, onSelectEpisode, onOpenEpisode, onBack }: {
  session: Session;
  series: SiloItem;
  initialEpisode?: SiloItem;
  onSelectEpisode: (episode: SiloItem) => void;
  onOpenEpisode: (episode: SiloItem) => void;
  onBack: () => void;
}) {
  const [show, setShow] = useState(series);
  const [seasons, setSeasons] = useState<SiloItem[]>([]);
  const [season, setSeason] = useState<SiloItem | null>(null);
  const [episodes, setEpisodes] = useState<SiloItem[]>([]);
  const [selected, setSelected] = useState<SiloItem | undefined>(initialEpisode);
  const [confirmedEpisodeId, setConfirmedEpisodeId] = useState<string | undefined>(initialEpisode?.Id);
  const [error, setError] = useState("");
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (series.Overview && (series.BackdropUrl || series.PosterUrl)) return;
    getCatalogItem(session, series.Id).then(setShow).catch(() => undefined);
  }, [series, session]);

  useEffect(() => {
    getSeasons(session, series.Id)
      .then((items) => {
        setSeasons(items);
        const wanted = initialEpisode?.ParentIndexNumber;
        setSeason(items.find(item => (item.IndexNumber ?? item.ParentIndexNumber) === wanted) ?? items[0] ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load seasons"));
  }, [session, series.Id, initialEpisode?.ParentIndexNumber]);

  useEffect(() => {
    if (!season) return;
    getEpisodes(session, series.Id, season.IndexNumber ?? season.ParentIndexNumber ?? 0)
      .then(items => {
        setEpisodes(items);
        setSelected(items.find(item => item.Id === initialEpisode?.Id) ?? items[0]);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load episodes"));
  }, [session, series.Id, season]);

  useEffect(() => {
    if (selected?.Id === initialEpisode?.Id) selectedRef.current?.focus();
  }, [selected?.Id, initialEpisode?.Id]);

  const number = selected ? `S${String(selected.ParentIndexNumber ?? 0).padStart(2, "0")}E${String(selected.IndexNumber ?? 0).padStart(2, "0")}` : "";

  return <main className="series-screen">
    <TvButton className="secondary top-back" onClick={onBack}>‹ Back</TvButton>
    <div className="series-hero" style={{ backgroundImage: `url("${backdropUrl(session, show)}")` }}>
      <div className="series-hero-scrim" />
      <div className="series-copy">
        <div className="eyebrow">Series</div>
        <h1>{show.Name}</h1>
        {selected ? <div className="selected-episode-info">
          <h2><span>{number}</span> {selected.Name}</h2>
          {selected.Overview ? <p>{selected.Overview}</p> : show.Overview ? <p>{show.Overview}</p> : null}
          <TvButton className={confirmedEpisodeId === selected.Id ? "episode-play-ready" : ""} onClick={() => onOpenEpisode(selected)}>▶ Play Episode</TvButton>
        </div> : show.Overview ? <p>{show.Overview}</p> : null}
      </div>
    </div>

    <section className="series-body">
      {error ? <div className="error">{error}</div> : null}
      <div className="season-tabs">{seasons.map(item => <button key={item.Id} data-tv-focusable="true" className={`season-tab ${season?.Id === item.Id ? "active" : ""}`} onClick={() => setSeason(item)}>{item.Name}</button>)}</div>
      <div className="episode-rail">{episodes.map(episode => <button
        ref={episode.Id === initialEpisode?.Id ? selectedRef : undefined}
        key={episode.Id}
        data-tv-focusable="true"
        className={`episode-tile ${selected?.Id === episode.Id ? "selected" : ""}`}
        aria-current={selected?.Id === episode.Id ? "true" : undefined}
        onFocus={() => {
          if (selected?.Id !== episode.Id) {
            setSelected(episode);
            setConfirmedEpisodeId(undefined);
            onSelectEpisode(episode);
          }
        }}
        onClick={() => {
          if (confirmedEpisodeId === episode.Id) onOpenEpisode(episode);
          else {
            setSelected(episode);
            setConfirmedEpisodeId(episode.Id);
            onSelectEpisode(episode);
          }
        }}
      >
        <div className="episode-tile-art">{imageUrl(session, episode) ? <img src={imageUrl(session, episode)} alt="" /> : null}{episode.UserData?.PlayedPercentage ? <i><span style={{ width: `${episode.UserData.PlayedPercentage}%` }} /></i> : null}</div>
        <strong>{episode.IndexNumber}. {episode.Name}</strong>
      </button>)}</div>
    </section>
  </main>;
}
