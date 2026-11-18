import { useEffect, useRef, useState } from "react";
import { getBoxSet } from "../api/silo";
import { ExpandableOverview } from "../components/ExpandableOverview";
import { PlayIcon } from "../components/icons";
import { LoadingState } from "../components/LoadingState";
import { MediaRail } from "../components/MediaRail";
import { boxSetFacts, boxSetPlayTarget } from "../core/boxSetPlay";
import type { Session, SiloBoxSet, SiloItem } from "../types";

/**
 * A movie box set (#171; Android TV #646, tvOS #852): the movie page's hero with the collection's
 * backdrop, title, film count and years, overview, and Play or Continue on the right film; the
 * films below in release order. Read again whenever it is shown, so watched marks are current.
 */
export function BoxSetScreen({ session, boxSetId, libraryId, title, onOpen, onPlay }: {
  session: Session;
  boxSetId: string;
  libraryId: string;
  title?: string;
  onOpen: (item: SiloItem) => void;
  onPlay: (item: SiloItem, startPosition: number) => void;
}) {
  const [boxSet, setBoxSet] = useState<SiloBoxSet | null>(null);
  const [error, setError] = useState("");
  const playRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    setError("");
    getBoxSet(session, boxSetId, libraryId)
      .then(next => { if (alive) setBoxSet(next); })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "Couldn't load this box set."); });
    return () => { alive = false; };
  }, [session, boxSetId, libraryId]);

  useEffect(() => {
    if (!boxSet) return;
    const frame = requestAnimationFrame(() => playRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [boxSet?.id]);

  if (error) return <main className="details-shell"><div className="details-content"><h1>{title ?? "Box Set"}</h1><div className="error">{error}</div></div></main>;
  if (!boxSet) return <LoadingState label="Loading box set" />;

  const target = boxSetPlayTarget(boxSet.items);
  return (
    <main className="details-shell box-set-shell">
      <div className="details-backdrop" style={{ backgroundImage: boxSet.backdropUrl ? `url("${boxSet.backdropUrl}")` : undefined }} />
      <div className="details-scrim" />
      <div className="details-content">
        <div className="box-set-eyebrow">BOX SET</div>
        <h1>{boxSet.title}</h1>
        <div className="details-facts"><span>{boxSetFacts(boxSet.movieCount, boxSet.firstYear, boxSet.lastYear)}</span>{boxSet.playedCount ? <span>{`${boxSet.playedCount} watched`}</span> : null}</div>
        {boxSet.overview ? <ExpandableOverview className="details-overview" text={boxSet.overview} title={boxSet.title} /> : null}
        <div className="details-actions">
          <button ref={playRef} type="button" data-tv-focusable="true" className="tv-button pin-open" disabled={!target}
            aria-label={target ? `${target.label}: ${target.item.Name}` : "Play"} onClick={() => target && onPlay(target.item, target.position)}>
            <PlayIcon />
            <span className="tv-button-label">{target?.label ?? "Play"}</span>
          </button>
        </div>
        {target && target.label === "Continue" ? <div className="details-credit">{`Next: ${target.item.Name}`}</div> : null}
      </div>
      <div className="details-related">
        <MediaRail rail={{ id: `boxset-${boxSet.id}`, title: "Films", items: boxSet.items }} session={session} onOpen={onOpen} slide />
      </div>
    </main>
  );
}
