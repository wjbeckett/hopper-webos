import { useEffect, useMemo, useState } from "react";
import { getCalendar, imageUrl } from "../api/silo";
import { MediaCard } from "../components/MediaCard";
import { focusFirstContentCard } from "../navigation/spatial";
import type { Session, SiloCalendarItem, SiloItem } from "../types";

type CalendarFilter = "all" | "following" | "trending";

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mondayOf(date: Date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function calendarItemToSiloItem(item: SiloCalendarItem): SiloItem {
  const episode = item.type.toLowerCase() === "episode";
  return {
    Id: item.contentId,
    Name: item.episodeTitle || item.title,
    Type: episode ? "Episode" : "Movie",
    SeriesName: episode ? item.title : undefined,
    SeriesId: episode ? item.seriesId : undefined,
    ParentIndexNumber: item.seasonNumber,
    IndexNumber: item.episodeNumber,
    ProductionYear: Number(item.airDate.slice(0, 4)) || undefined,
    PosterUrl: item.posterUrl,
    UserData: { Played: item.watched }
  };
}

const filters: { value: CalendarFilter; label: string }[] = [
  { value: "following", label: "Following" },
  { value: "trending", label: "Trending" },
  { value: "all", label: "All" }
];

export function CalendarScreen({ session, onOpen }: {
  session: Session;
  onOpen: (item: SiloItem) => void;
}) {
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
  const [filter, setFilter] = useState<CalendarFilter>("all");
  const [days, setDays] = useState<Awaited<ReturnType<typeof getCalendar>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const dates = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = new Date(week);
    date.setDate(week.getDate() + index);
    return date;
  }), [week]);
  const selectedItems = days.find(day => day.date === selectedDate)?.items ?? [];

  useEffect(() => {
    let alive = true;
    const end = new Date(week);
    end.setDate(week.getDate() + 6);
    setLoading(true);
    setError("");
    getCalendar(session, dateKey(week), dateKey(end), filter)
      .then(result => { if (alive) setDays(result); })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "Could not load the release calendar."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [session, week, filter]);

  useEffect(() => {
    if (loading) return;
    const frame = requestAnimationFrame(focusFirstContentCard);
    return () => cancelAnimationFrame(frame);
  }, [loading, selectedItems]);

  function moveWeek(amount: number) {
    const next = new Date(week);
    next.setDate(week.getDate() + amount * 7);
    setWeek(next);
    setSelectedDate(dateKey(next));
  }

  return (
    <main className="content-screen calendar-screen">
      <div className="calendar-toolbar">
        <button type="button" className="tv-button secondary" data-tv-focusable="true" onClick={() => moveWeek(-1)}>‹ Previous week</button>
        <div className="calendar-filters" aria-label="Calendar filter">
          {filters.map(option => (
            <button
              key={option.value}
              type="button"
              data-tv-focusable="true"
              className={`library-view-tab ${filter === option.value ? "active" : ""}`}
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button type="button" className="tv-button secondary" data-tv-focusable="true" onClick={() => moveWeek(1)}>Next week ›</button>
      </div>
      <div className="calendar-week" aria-label="Week">
        {dates.map(date => {
          const key = dateKey(date);
          const count = days.find(day => day.date === key)?.items.length ?? 0;
          return (
            <button
              key={key}
              type="button"
              data-tv-focusable="true"
              className={`calendar-day ${selectedDate === key ? "active" : ""}`}
              aria-pressed={selectedDate === key}
              onClick={() => setSelectedDate(key)}
            >
              <span>{date.toLocaleDateString(undefined, { weekday: "short" })}</span>
              <strong>{date.getDate()}</strong>
              <small>{count ? `${count} titles` : "—"}</small>
            </button>
          );
        })}
      </div>
      {error ? <div className="error">{error}</div> : null}
      {loading ? <div className="screen-state">Loading release calendar…</div> : selectedItems.length ? (
        <section className="calendar-releases" aria-label={`Releases for ${selectedDate}`}>
          <h2>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</h2>
          <div className="library-grid">
            {selectedItems.map(calendarItem => {
              const item = calendarItemToSiloItem(calendarItem);
              return (
                <div className="calendar-release" key={calendarItem.contentId}>
                  <MediaCard session={session} item={item} image={imageUrl(session, item)} onOpen={() => onOpen(item)} />
                  <div className="calendar-release-meta">
                    {calendarItem.airTime ? <span>{calendarItem.airTime}</span> : null}
                    {calendarItem.badges.map(badge => <span key={badge}>{badge.replace(/_/g, " ")}</span>)}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : !error ? <div className="empty-state compact-empty-state"><h2>No releases for this day</h2><p>Choose another day or calendar filter.</p></div> : null}
    </main>
  );
}
