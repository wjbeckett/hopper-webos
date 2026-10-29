import type { SiloItem } from "../types";

type Props = {
  item: SiloItem;
  image: string;
  onOpen: () => void;
  landscape?: boolean;
  variant?: "browse";
};

function subtitle(item: SiloItem) {
  if (item.Type === "Episode") {
    const season = item.ParentIndexNumber != null ? `S${String(item.ParentIndexNumber).padStart(2, "0")}` : "";
    const episode = item.IndexNumber != null ? `E${String(item.IndexNumber).padStart(2, "0")}` : "";
    return [item.SeriesName, [season, episode].filter(Boolean).join("")].filter(Boolean).join(" · ") || "Episode";
  }
  return [item.Type, item.ProductionYear].filter(Boolean).join(" · ") || "Media";
}

export function MediaCard({ item, image, onOpen, landscape = false, variant }: Props) {
  const browse = variant === "browse";
  const progress = Math.max(0, Math.min(100, item.UserData?.PlayedPercentage ?? 0));
  const watched = item.UserData?.Played === true || progress >= 100;

  return (
    <button
      data-tv-focusable="true"
      data-media-id={item.Id}
      className={`media-card ${landscape ? "landscape" : ""} ${watched ? "watched" : ""} ${browse ? "browse" : ""} ${browse && item.Type === "AudioBook" ? "square" : ""}`}
      onClick={onOpen}
      aria-label={item.Name}
    >
      <div className="media-card-art">
        <div className="media-card-placeholder" aria-hidden="true">
          {item.Name.slice(0, 1).toUpperCase()}
        </div>
        {image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            onError={(event) => { event.currentTarget.hidden = true; }}
          />
        ) : null}
        {watched ? (
          browse
            ? <span className="media-card-watched-check" aria-label="Watched">✓</span>
            : <span className="media-card-watched" aria-label="Watched">✓ Watched</span>
        ) : null}
        {!browse && progress > 0 && progress < 100 ? (
          <div className="progress-track" aria-label={`${Math.round(progress)}% watched`}><span style={{ width: `${progress}%` }} /></div>
        ) : null}
      </div>
      <div className="media-card-title">{item.Name}</div>
      <div className="media-card-meta">{browse ? item.ProductionYear || "" : subtitle(item)}</div>
    </button>
  );
}
