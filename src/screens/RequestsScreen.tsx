import { useEffect, useMemo, useState } from "react";
import {
  cancelMediaRequest,
  createMediaRequest,
  getMyRequests,
  getRequestDetail,
  getRequestsDiscover,
  getRequestsFeatureStatus,
  requestArtworkUrl,
  searchRequests,
  setRequestFollow
} from "../api/silo";
import { focusFirstContentCard } from "../navigation/spatial";
import type { Session, SiloMediaRequest, SiloRequestResult } from "../types";

type RequestsTab = "discover" | "mine";

function requestStateLabel(state?: string, fallback?: string) {
  return (state || fallback || "pending").replace(/_/g, " ");
}

export function RequestsScreen({ session }: { session: Session }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [followSupported, setFollowSupported] = useState(false);
  const [tab, setTab] = useState<RequestsTab>("discover");
  const [rows, setRows] = useState<Array<{ key: string; title: string; items: SiloRequestResult[] }>>([]);
  const [requests, setRequests] = useState<SiloMediaRequest[]>([]);
  const [query, setQuery] = useState("");
  const [mediaType, setMediaType] = useState("all");
  const [searchResults, setSearchResults] = useState<SiloRequestResult[] | null>(null);
  const [selected, setSelected] = useState<SiloRequestResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cancelingId, setCancelingId] = useState("");
  const [actionError, setActionError] = useState("");

  const visibleResults = useMemo(() => searchResults ?? [], [searchResults]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    getRequestsFeatureStatus(session)
      .then(async status => {
        if (!alive) return;
        const permitted = status.requests_enabled && status.allowed === true && status.state === "available";
        setAvailable(permitted);
        setFollowSupported(status.follow_supported === true);
        if (!permitted) return;
        const [discover, mine] = await Promise.all([getRequestsDiscover(session), getMyRequests(session)]);
        if (!alive) return;
        setRows(discover);
        setRequests(mine);
      })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "Could not load requests."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [session]);

  useEffect(() => {
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      searchRequests(session, query.trim(), mediaType)
        .then(result => { if (alive) setSearchResults(result); })
        .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "Request search failed."); });
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [session, query, mediaType]);

  useEffect(() => {
    if (loading || selected) return;
    const frame = requestAnimationFrame(focusFirstContentCard);
    return () => cancelAnimationFrame(frame);
  }, [loading, selected, tab, rows, requests, searchResults]);

  async function openItem(item: SiloRequestResult) {
    setSelected(item);
    setDetailLoading(true);
    setActionError("");
    try {
      setSelected(await getRequestDetail(session, item));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not load request details.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function submitRequest(item: SiloRequestResult) {
    setBusy(true);
    setActionError("");
    try {
      const request = await createMediaRequest(session, item);
      setRequests(current => [request, ...current.filter(existing => existing.id !== request.id)]);
      setNotice(`Request submitted for ${request.title}.`);
      setSelected(null);
      setTab("mine");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not submit this request.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleFollow(item: SiloRequestResult) {
    setBusy(true);
    setActionError("");
    try {
      await setRequestFollow(session, item, !item.following);
      setSelected({ ...item, following: !item.following });
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not update notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelRequest(request: SiloMediaRequest) {
    setCancelingId(request.id);
    setActionError("");
    try {
      const updated = await cancelMediaRequest(session, request.id);
      setRequests(current => current.map(item => item.id === updated.id ? updated : item));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not cancel this request.");
    } finally {
      setCancelingId("");
    }
  }

  if (selected) {
    return (
      <main className="content-screen requests-screen" onKeyDownCapture={event => {
        if (["Escape", "Backspace", "Back", "GoBack", "BrowserBack"].includes(event.key) || event.keyCode === 461 || event.keyCode === 10009) {
          setSelected(null);
          event.preventDefault();
          event.stopPropagation();
        }
      }}>
        <button data-tv-focusable="true" className="tv-button secondary" onClick={() => setSelected(null)}>‹ Requests</button>
        <div className="request-detail">
          {requestArtworkUrl(selected.backdropPath) ? <img className="request-detail-backdrop" src={requestArtworkUrl(selected.backdropPath)} alt="" /> : null}
          <div className="request-detail-copy">
            <div className="eyebrow">{selected.mediaType} {selected.year ? `· ${selected.year}` : ""}</div>
            <h1>{selected.title}</h1>
            <p>{selected.overview}</p>
            <div className="request-detail-state">{selected.availability === "available" ? "Available in your library" : requestStateLabel(undefined, selected.reason)}</div>
            {actionError ? <div className="error">{actionError}</div> : null}
            {detailLoading ? <div className="screen-state">Loading title details…</div> : null}
            <div className="request-detail-actions">
              {selected.requestable ? (
                <button data-tv-focusable="true" className="tv-button" disabled={busy} onClick={() => void submitRequest(selected)}>＋ Request</button>
              ) : null}
              {followSupported && selected.availability !== "available" ? (
                <button data-tv-focusable="true" className="tv-button secondary" disabled={busy} onClick={() => void toggleFollow(selected)}>
                  {selected.following ? "✓ Following" : "◉ Notify me"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="content-screen requests-screen">
      <div className="requests-controls">
        <div className="requests-tabs">
          <button data-tv-focusable="true" className={`library-view-tab ${tab === "discover" ? "active" : ""}`} onClick={() => setTab("discover")}>Discover</button>
          <button data-tv-focusable="true" className={`library-view-tab ${tab === "mine" ? "active" : ""}`} onClick={() => setTab("mine")}>My Requests</button>
        </div>
        {tab === "discover" ? (
          <div className="requests-search">
            <input data-tv-focusable="true" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search movies, series, audiobooks…" aria-label="Search requests" />
            <select data-tv-focusable="true" value={mediaType} onChange={event => setMediaType(event.target.value)} aria-label="Media type">
              <option value="all">All types</option>
              <option value="movie">Movies</option>
              <option value="series">Series</option>
              <option value="audiobook">Audiobooks</option>
            </select>
          </div>
        ) : null}
      </div>
      {notice ? <div className="success-message" role="status">{notice}</div> : null}
      {actionError ? <div className="error">{actionError}</div> : null}
      {error ? <div className="error">{error}</div> : null}
      {loading ? <div className="screen-state">Loading requests…</div> : available === false ? (
        <div className="empty-state"><h2>Requests unavailable</h2><p>Requests are disabled for this server or profile.</p></div>
      ) : tab === "mine" ? requests.length ? (
        <div className="request-list">
          {requests.map(request => (
            <article key={request.id} className="request-row">
              <div>
                <button className="request-row-title" data-tv-focusable="true" onClick={() => void openItem({
                  mediaType: request.mediaType,
                  tmdbId: request.tmdbId,
                  title: request.title,
                  year: request.year,
                  overview: "",
                  availability: "missing",
                  requestable: false,
                  reason: requestStateLabel(request.state, request.status),
                  requestId: request.id,
                  following: false
                })}>{request.title}</button>
                <small>{request.year ?? request.mediaType} · {requestStateLabel(request.state, request.status)}</small>
              </div>
              {request.outcome === "active" ? <button data-tv-focusable="true" className="tv-button secondary" disabled={cancelingId === request.id} onClick={() => void cancelRequest(request)}>{cancelingId === request.id ? "Cancelling…" : "Cancel request"}</button> : null}
            </article>
          ))}
        </div>
      ) : <div className="empty-state"><h2>No requests yet</h2><p>Browse titles and request something to watch.</p></div> : (
        searchResults ? (
          <section className="request-results">
            <h2>Search results</h2>
            <div className="request-grid">{visibleResults.map(item => <RequestCard key={`${item.mediaType}-${item.tmdbId}`} item={item} onOpen={() => void openItem(item)} />)}</div>
            {!visibleResults.length ? <div className="empty-state compact-empty-state"><h2>No matches</h2></div> : null}
          </section>
        ) : rows.map(row => (
          <section className="request-results" key={row.key}>
            <h2>{row.title}</h2>
            <div className="request-grid">{row.items.map(item => <RequestCard key={`${item.mediaType}-${item.tmdbId}`} item={item} onOpen={() => void openItem(item)} />)}</div>
          </section>
        ))
      )}
    </main>
  );
}

function RequestCard({ item, onOpen }: { item: SiloRequestResult; onOpen: () => void }) {
  const image = requestArtworkUrl(item.posterPath);
  return (
    <button data-tv-focusable="true" className="request-card" onClick={onOpen} aria-label={`${item.title}, ${item.year ?? item.mediaType}`}>
      <div className="request-card-art">
        {image ? <img src={image} alt="" loading="lazy" /> : <span aria-hidden="true">{item.title.slice(0, 1)}</span>}
      </div>
      <strong>{item.title}</strong>
      <small>{item.year ?? item.mediaType} · {item.availability === "available" ? "Available" : item.requestable ? "Requestable" : requestStateLabel(undefined, item.reason)}</small>
    </button>
  );
}
