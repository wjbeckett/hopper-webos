import { useEffect, useState } from "react";
import { getLibrariesRails } from "../api/silo";
import { FeaturedRailsScreen } from "../components/FeaturedRailsScreen";
import { focusFirstContentCard } from "../navigation/spatial";
import type { HomeRail, Session, SiloItem, SiloLibrary } from "../types";

export function LibraryRecommendationsScreen({
  session,
  title,
  libraries,
  onOpen
}: {
  session: Session;
  title: string;
  libraries: SiloLibrary[];
  onOpen: (item: SiloItem) => void;
}) {
  const [rails, setRails] = useState<HomeRail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    getLibrariesRails(session, libraries)
      .then(next => { if (alive) setRails(next); })
      .catch(cause => {
        if (alive) setError(cause instanceof Error ? cause.message : `Could not load ${title}.`);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [session, libraries, title]);

  useEffect(() => {
    if (loading) return;
    const frame = requestAnimationFrame(focusFirstContentCard);
    return () => cancelAnimationFrame(frame);
  }, [loading, rails]);

  if (loading) return <div className="screen-state">Loading {title}…</div>;

  return (
    <FeaturedRailsScreen
      rails={rails}
      session={session}
      onOpen={onOpen}
      error={error}
      emptyMark="✦"
      emptyTitle={`No ${title} recommendations yet`}
      emptyDescription="There aren’t any picks for this library right now."
    />
  );
}
