import { useCallback, useEffect, useRef, useState } from "react";
import { getAudiobookGroupsPage, imageUrl } from "../api/silo";
import type { AudiobookGroup } from "../api/silo";
import { MediaCard } from "../components/MediaCard";
import { focusFirstContentCard, focusNavigationTarget } from "../navigation/spatial";
import type { Session, SiloLibrary } from "../types";
import { LoadingState } from "../components/LoadingState";

export type GroupKind = "author" | "series";

const lastFocused = new Map<string, string>();

export function groupSubtitle(group: AudiobookGroup) {
  const parts = [`${group.itemCount} ${group.itemCount === 1 ? "book" : "books"}`];
  const seconds = group.durationSeconds ?? 0;
  if (seconds > 0) {
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    parts.push(hours && rest ? `${hours}h ${rest}m` : hours ? `${hours}h` : minutes ? `${minutes}m` : "<1m");
  }
  if (group.inProgressCount > 0) parts.push(`${group.inProgressCount} in progress`);
  return parts.join(" • ");
}

export function AudiobookGroupsScreen({ session, library, kind, onOpen }: {
  session: Session;
  library: SiloLibrary;
  kind: GroupKind;
  onOpen: (group: AudiobookGroup) => void;
}) {
  const [groups, setGroups] = useState<AudiobookGroup[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  const loadingMore = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const scopeKey = `${session.serverUrl}|${session.profileId ?? ""}|${library.id}|${kind}`;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setGroups([]);
    setCursor(undefined);
    getAudiobookGroupsPage(session, library.id, kind)
      .then(page => {
        if (!alive) return;
        setGroups(page.groups);
        setCursor(page.nextCursor);
      })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "Could not load audiobook groups."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [session, library.id, kind, nonce]);

  useEffect(() => {
    if (loading) return;
    const frame = requestAnimationFrame(() => {
      const remembered = lastFocused.get(scopeKey);
      const target = remembered ? document.querySelector<HTMLElement>(`[data-group-key="${CSS.escape(remembered)}"] button`) : null;
      if (target) {
        target.scrollIntoView({ block: "center" });
        focusNavigationTarget(target);
      } else {
        focusFirstContentCard();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [loading, scopeKey]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const page = await getAudiobookGroupsPage(session, library.id, kind, cursor);
      setGroups(current => {
        const names = new Set(current.map(group => group.name));
        return [...current, ...page.groups.filter(group => !names.has(group.name))];
      });
      setCursor(page.nextCursor === cursor ? undefined : page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load more.");
      setCursor(undefined);
    } finally {
      loadingMore.current = false;
    }
  }, [cursor, session, library.id, kind]);

  useEffect(() => {
    const target = sentinel.current;
    if (!target || !cursor || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "1600px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [cursor, loadMore, groups.length]);

  const noun = kind === "author" ? "authors" : "series";

  return (
    <main className="content-screen collection-screen">
      {loading ? <LoadingState label="Loading" /> : error && !groups.length ? (
        <div className="screen-state browse-error-state">
          <div>{error}</div>
          <div className="browse-error-actions">
            <button type="button" data-tv-focusable="true" className="browse-dropdown-trigger" onClick={() => setNonce(value => value + 1)}>
              <span>Retry</span>
            </button>
          </div>
        </div>
      ) : !groups.length ? <div className="screen-state">{`No audiobook ${noun} found.`}</div> : (
        <>
          <div className="collection-grid audiobook-group-grid">
            {groups.map(group => {
              const poster = group.posterUrls.find(url => url.trim());
              return (
                <div key={group.name} data-group-key={group.name}>
                  <MediaCard
                    session={session}
                    item={{ Id: group.name, Name: group.name, PosterUrl: poster, Type: "AudioBook" }}
                    image={imageUrl(session, { Id: group.name, Name: group.name, PosterUrl: poster })}
                    caption={groupSubtitle(group)}
                    variant="browse"
                    square
                    onOpen={() => { lastFocused.set(scopeKey, group.name); onOpen(group); }}
                  />
                </div>
              );
            })}
          </div>
          {cursor ? <div ref={sentinel} className="browse-load-more" aria-hidden="true" /> : null}
        </>
      )}
    </main>
  );
}
