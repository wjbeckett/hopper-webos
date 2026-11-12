import { hideThemeMusic, showThemeMusic } from "../core/themeMusic";
import { useEffect, useState } from "react";
import { placeRailItem } from "../navigation/spatial";
import { getDetailExtras } from "../api/silo";
import type { DetailExtras, DetailPerson, DetailTrailer } from "../api/silo";
import { openYoutube } from "../platform/youtube";
import type { Session } from "../types";

export type DetailFact = { label: string; value: string };

export function useDetailExtras(session: Session, contentId: string) {
  const [extras, setExtras] = useState<DetailExtras | null>(null);
  useEffect(() => {
    let alive = true;
    setExtras(null);
    getDetailExtras(session, contentId).then(next => { if (alive) setExtras(next); }).catch(() => undefined);
    return () => { alive = false; };
  }, [session, contentId]);
  useEffect(() => {
    const owner = {};
    showThemeMusic(owner, extras?.themes ?? null);
    return () => hideThemeMusic(owner);
  }, [extras]);
  return extras;
}

function duration(seconds?: number) {
  if (!seconds || seconds <= 0) return "";
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${Math.max(1, minutes)}m`;
}

export function CastSection({ cast, restoreIndex, onOpen }: {
  cast: DetailPerson[];
  restoreIndex?: number;
  onOpen: (person: DetailPerson, index: number) => void;
}) {
  useEffect(() => {
    if (restoreIndex == null) return;
    const frame = requestAnimationFrame(() => {
      const card = document.querySelector<HTMLElement>(`[data-cast-index="${restoreIndex}"]`);
      if (card) {
        card.scrollIntoView({ block: "center", inline: "nearest" });
        placeRailItem(card);
        card.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [restoreIndex, cast.length]);

  if (!cast.length) return null;
  return (
    <section className="detail-section">
      <h2>Cast &amp; Crew</h2>
      <div className="detail-cast-track" data-slide="true"><div className="rail-strip">
        {cast.map((person, index) => (
          <button key={`${person.name}-${index}`} type="button" data-tv-focusable="true" data-cast-index={index} className="detail-cast-card" onClick={() => onOpen(person, index)}>
            <span className="detail-cast-photo">
              {person.photoUrl ? <img src={person.photoUrl} alt="" loading="lazy" onError={event => { event.currentTarget.hidden = true; }} /> : <span>{person.name.slice(0, 1).toUpperCase()}</span>}
            </span>
            <strong>{person.name}</strong>
            {person.role ? <small>{person.role}</small> : null}
          </button>
        ))}
      </div></div>
    </section>
  );
}

export function TrailersSection({ trailers, onPlayLocal }: {
  trailers: DetailTrailer[];
  onPlayLocal: (trailer: DetailTrailer) => void;
}) {
  if (!trailers.length) return null;
  return (
    <section className="detail-section">
      <h2>Trailers &amp; More</h2>
      <div className="detail-trailer-track" data-slide="true"><div className="rail-strip">
        {trailers.map(trailer => (
          <button key={trailer.key} type="button" data-tv-focusable="true" className="detail-trailer-card"
            onClick={() => trailer.kind === "youtube" && trailer.youtubeKey ? openYoutube(trailer.youtubeKey) : onPlayLocal(trailer)}>
            <span className="detail-trailer-art">
              {trailer.thumbnail ? <img src={trailer.thumbnail} alt="" loading="lazy" onError={event => { event.currentTarget.hidden = true; }} /> : null}
              {trailer.durationSeconds ? <em>{duration(trailer.durationSeconds)}</em> : null}
            </span>
            <strong>{trailer.title}</strong>
          </button>
        ))}
      </div></div>
    </section>
  );
}

export function FactsSection({ facts }: { facts: DetailFact[] }) {
  const rows = facts.filter(fact => fact.value);
  if (!rows.length) return null;
  return (
    <section className="detail-section">
      <h2>Details</h2>
      <div className="detail-facts-table" tabIndex={0} data-tv-focusable="true" role="group" aria-label="Details">
        {rows.map(fact => (
          <div key={fact.label} className="detail-facts-row">
            <span>{fact.label}</span>
            <strong>{fact.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export function factsFor(extras: DetailExtras | null, extra: DetailFact[] = []): DetailFact[] {
  if (!extras) return extra;
  const crewNames = (job: string) => extras.crew.filter(member => member.role?.toLowerCase() === job).map(member => member.name).slice(0, 4).join(", ");
  return [
    ...extra,
    { label: "Status", value: extras.showStatus ?? "" },
    { label: "Director", value: crewNames("director") },
    { label: "Writers", value: [...new Set([...extras.crew.filter(member => ["writer", "screenplay", "creator"].includes(member.role?.toLowerCase() ?? "")).map(member => member.name)])].slice(0, 4).join(", ") },
    { label: "Studios", value: extras.studios.slice(0, 4).join(", ") },
    { label: "Networks", value: extras.networks.slice(0, 4).join(", ") },
    { label: "Countries", value: extras.countries.slice(0, 4).join(", ") },
    { label: "Original language", value: extras.originalLanguage ?? "" }
  ];
}
