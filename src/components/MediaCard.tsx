import type { SiloItem } from "../types";

type Props = {
  item: SiloItem;
  image: string;
  onOpen: () => void;
  landscape?: boolean;
};

function subtitle(item: SiloItem) {
  if (item.Type === "Episode") {
    const season = item.ParentIndexNumber != null ? `S${item.ParentIndexNumber}` : "";
    const episode = item.IndexNumber != null ? `E${item.IndexNumber}` : "";
    return `${item.SeriesName ?? ""} ${season}${episode}`.trim();
  }
  return item.ProductionYear ? String(item.ProductionYear) : item.Type ?? "";
}

export function MediaCard({ item, image, onOpen, landscape = false }: Props) {
  const progress = Math.max(0, Math.min(100, item.UserData?.PlayedPercentage ?? 0));

  return (
    <button
      data-tv-focusable="true"
      className={`media-card ${landscape ? "landscape" : ""}`}
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
        {progress > 0 && progress < 100 ? (
          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
        ) : null}
      </div>
      <div className="media-card-title">{item.Name}</div>
      <div className="media-card-meta">{subtitle(item)}</div>
    </button>
  );
}
