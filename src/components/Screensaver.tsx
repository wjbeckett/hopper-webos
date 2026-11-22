import { useEffect, useRef, useState } from "react";
import { backdropUrl, getScreensaverTitles, mediaLogoUrl } from "../api/silo";
import { revealCorner } from "../core/screensaver";
import type { Session, SiloItem } from "../types";

/** How long each title stays, and when its name appears: long enough to have a guess first. */
const SLIDE_MS = 15000;
const REVEAL_MS = 6000;

type Caption = { item: SiloItem; corner: "left" | "right"; shown: boolean };

/**
 * The screensaver (#209): random titles' backdrops, one after another, with each name revealed in a
 * bottom corner a few seconds in, as a guessing game. The corner alternates, so nothing stays in one
 * place on the panel. App decides when it shows and closes it on any key or pointer movement.
 *
 * Like the Home backdrop on a TV, the two images stay mounted and trade places by opacity, set
 * outside React, so a slide change never builds or tears down a layer.
 */
export function Screensaver({ session, onEmpty }: { session: Session; onEmpty: () => void }) {
  const first = useRef<HTMLImageElement>(null);
  const second = useRef<HTMLImageElement>(null);
  const [caption, setCaption] = useState<Caption | null>(null);
  /** Until the first picture is ready the screen behind stays as it is, so a saver with nothing to show never flashes black. */
  const [ready, setReady] = useState(false);
  const [logoFailed, setLogoFailed] = useState("");
  const onEmptyRef = useRef(onEmpty);
  onEmptyRef.current = onEmpty;

  useEffect(() => {
    let alive = true;
    let queue: SiloItem[] = [];
    let front = 0;
    let slide = 0;
    let revealTimer: number | undefined;
    let slideTimer: number | undefined;

    async function nextTitle(): Promise<SiloItem | null> {
      if (!queue.length) {
        try { queue = await getScreensaverTitles(session); } catch { queue = []; }
      }
      return queue.shift() ?? null;
    }

    async function advance(failures = 0) {
      if (!alive) return;
      const item = await nextTitle();
      if (!alive) return;
      if (!item) { onEmptyRef.current(); return; }
      const images = [first.current, second.current];
      const back = images[1 - front];
      const current = images[front];
      if (!back || !current) return;
      back.src = backdropUrl(session, item);
      try {
        await back.decode();
      } catch {
        // A backdrop that won't load: try the next title, a few times at most.
        if (failures < 5) void advance(failures + 1); else onEmptyRef.current();
        return;
      }
      if (!alive) return;
      current.classList.remove("shown");
      back.classList.add("shown");
      setReady(true);
      front = 1 - front;
      const corner = revealCorner(slide);
      slide += 1;
      setCaption({ item, corner, shown: false });
      revealTimer = window.setTimeout(() => setCaption(previous => previous && previous.item === item ? { ...previous, shown: true } : previous), REVEAL_MS);
      slideTimer = window.setTimeout(() => {
        setCaption(previous => previous && previous.item === item ? { ...previous, shown: false } : previous);
        void advance();
      }, SLIDE_MS);
    }

    void advance();
    return () => {
      alive = false;
      window.clearTimeout(revealTimer);
      window.clearTimeout(slideTimer);
    };
  }, [session]);

  const logo = caption ? mediaLogoUrl(session, caption.item) : "";
  return (
    <div className={`screensaver${ready ? " ready" : ""}`} aria-hidden="true">
      <img ref={first} className="screensaver-image" alt="" decoding="async" />
      <img ref={second} className="screensaver-image" alt="" decoding="async" />
      <div className="screensaver-shade" />
      {caption ? (
        <div key={caption.item.Id} className={`screensaver-caption ${caption.corner}${caption.shown ? " shown" : ""}`}>
          {logo && logoFailed !== logo
            ? <img className="screensaver-logo" src={logo} alt="" onError={() => setLogoFailed(logo)} />
            : <span className="screensaver-title">{caption.item.Name}</span>}
          {caption.item.ProductionYear ? <span className="screensaver-year">{caption.item.ProductionYear}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
