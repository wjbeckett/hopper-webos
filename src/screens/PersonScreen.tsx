import { useEffect, useRef, useState } from "react";
import { findPersonId, getPerson, getPersonFilmographyPage, imageUrl } from "../api/silo";
import type { PersonDetail } from "../api/silo";
import { MediaCard } from "../components/MediaCard";
import { focusFirstContentCard } from "../navigation/spatial";
import type { Session, SiloItem } from "../types";

export function PersonScreen({ session, personId, name, onOpen, onBack }: {
  session: Session;
  personId?: string;
  name: string;
  onOpen: (item: SiloItem) => void;
  onBack: () => void;
}) {
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [items, setItems] = useState<SiloItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bioOpen, setBioOpen] = useState(false);
  const busy = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const resolvedId = useRef<string | undefined>(personId);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    (async () => {
      const id = personId ?? await findPersonId(session, name);
      if (!id) throw new Error("This person could not be found.");
      resolvedId.current = id;
      const [detail, page] = await Promise.all([getPerson(session, id), getPersonFilmographyPage(session, id)]);
      if (!alive) return;
      setPerson(detail);
      setItems(page.items);
      setCursor(page.nextCursor);
    })()
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "Could not load this person."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [session, personId, name]);

  useEffect(() => {
    if (loading) return;
    const frame = requestAnimationFrame(() => focusFirstContentCard());
    return () => cancelAnimationFrame(frame);
  }, [loading]);

  useEffect(() => {
    const target = sentinel.current;
    if (!target || !cursor || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(async entries => {
      if (!entries.some(entry => entry.isIntersecting) || busy.current || !resolvedId.current) return;
      busy.current = true;
      try {
        const page = await getPersonFilmographyPage(session, resolvedId.current, cursor);
        setItems(current => {
          const ids = new Set(current.map(item => item.Id));
          return [...current, ...page.items.filter(item => !ids.has(item.Id))];
        });
        setCursor(page.nextCursor === cursor ? undefined : page.nextCursor);
      } catch {
        setCursor(undefined);
      } finally {
        busy.current = false;
      }
    }, { rootMargin: "1200px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [cursor, session, items.length]);

  const life = [person?.birthDate, person?.deathDate].filter(Boolean).join(" – ");

  return (
    <main className="content-screen person-screen">
      <button type="button" data-tv-focusable="true" className="tv-button secondary" onClick={onBack}>‹ Back</button>
      {loading ? <div className="screen-state">Loading...</div> : error ? <div className="screen-state">{error}</div> : person ? (
        <>
          <header className="person-header">
            <div className="person-photo">
              {person.photoUrl ? <img src={person.photoUrl} alt="" onError={event => { event.currentTarget.hidden = true; }} /> : <span>{person.name.slice(0, 1).toUpperCase()}</span>}
            </div>
            <div className="person-copy">
              <h1>{person.name}</h1>
              {life || person.birthplace ? <div className="details-tokens">{[life, person.birthplace].filter(Boolean).join(" · ")}</div> : null}
              {person.bio ? (
                <button type="button" data-tv-focusable="true" className={`person-bio ${bioOpen ? "open" : ""}`} onClick={() => setBioOpen(open => !open)}>{person.bio}</button>
              ) : null}
            </div>
          </header>
          <h2 className="person-filmography-title">Filmography</h2>
          {items.length ? (
            <div className="library-grid">
              {items.map(item => <MediaCard key={item.Id} session={session} item={item} image={imageUrl(session, item)} variant="browse" onOpen={() => onOpen(item)} />)}
            </div>
          ) : <div className="screen-state">No titles found.</div>}
          {cursor ? <div ref={sentinel} className="browse-load-more" aria-hidden="true" /> : null}
        </>
      ) : null}
    </main>
  );
}
