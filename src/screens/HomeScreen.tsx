import { useEffect, useState } from "react";
import { getHomeRails } from "../api/silo";
import { MediaRail } from "../components/MediaRail";
import type { HomeRail, Session, SiloItem } from "../types";

export function HomeScreen({
  session,
  onOpen
}: {
  session: Session;
  onOpen: (item: SiloItem) => void;
}) {
  const [rails, setRails] = useState<HomeRail[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getHomeRails(session)
      .then((next) => alive && setRails(next))
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Failed to load home"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [session]);

  if (loading) return <div className="screen-state">Loading your Silo…</div>;

  return (
    <main className="content-screen">
      <section className="hero-copy">
        <div className="eyebrow">Welcome back</div>
        <h1>{session.username}</h1>
      </section>
      {error ? <div className="error">{error}</div> : null}
      {rails.map((rail) => (
        <MediaRail key={rail.id} rail={rail} session={session} onOpen={onOpen} />
      ))}
    </main>
  );
}
