import { useEffect, useRef, useState } from "react";
import { getHomeRails } from "../api/silo";
import { arrangeHomeRails, readHomeSectionLayout, retainedOrder, writeHomeSectionLayout } from "../core/homeSections";
import type { HomeRail, Session } from "../types";
import { SettingsGlyph } from "./icons";

function isBackKey(event: KeyboardEvent) {
  return ["Escape", "Backspace", "Back", "GoBack", "BrowserBack"].includes(event.key) || event.keyCode === 461 || event.keyCode === 10009;
}

export function HomeSectionsEditor({ session, onClose }: { session: Session; onClose: () => void }) {
  const [rails, setRails] = useState<HomeRail[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [layout, setLayout] = useState(() => readHomeSectionLayout(session));
  const [editing, setEditing] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    getHomeRails(session).then(next => alive && setRails(next)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [session]);

  useEffect(() => {
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>("[data-home-done]")?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (!isBackKey(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const arranged = arrangeHomeRails(rails ?? [], layout, true);

  function commit(next: typeof layout) {
    setLayout(next);
    writeHomeSectionLayout(session, next);
  }

  function toggle(id: string) {
    const hidden = layout.hidden.includes(id) ? layout.hidden.filter(entry => entry !== id) : [...layout.hidden, id];
    commit({ ...layout, hidden });
  }

  function move(id: string, offset: number) {
    const ids = arranged.map(rail => rail.id);
    const index = ids.indexOf(id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    commit({ ...layout, order: retainedOrder(ids, layout.order) });
    const direction = target === 0 ? "down" : target === ids.length - 1 ? "up" : offset < 0 ? "up" : "down";
    requestAnimationFrame(() => requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(`[data-rail-id='${CSS.escape(id)}'] [data-move='${direction}']`)?.focus()));
  }

  return (
    <div className="home-sections-editor" data-modal="true" ref={rootRef}>
      <div className="home-sections-column">
        <h1>Home Sections</h1>
        <p className="home-sections-eyebrow">HOME SECTIONS</p>
        <div className="home-sections-card home-sections-head">
          <span className="home-sections-text">
            <strong>Home Sections</strong>
            <small>{editing ? "Move rows into your preferred order." : "Choose which rows appear on Home."}</small>
          </span>
          <button data-tv-focusable="true" className="home-sections-button" disabled={arranged.length < 2} onClick={() => setEditing(value => !value)}>{editing ? "Done Editing" : "Edit"}</button>
          <button data-tv-focusable="true" data-home-done className="home-sections-button" onClick={onClose}>Done</button>
        </div>
        {rails === null && !failed ? <p className="home-sections-message">Loading Home sections...</p> : null}
        {failed && rails === null ? <p className="home-sections-message">Silo couldn't refresh the Home rows. Try again when the server is reachable.</p> : null}
        {rails !== null && arranged.length === 0 ? <p className="home-sections-message">Home has no populated rows to arrange yet.</p> : null}
        {arranged.length > 0 ? (
          <>
            <div className="home-sections-list">
              {arranged.map((rail, index) => {
                const visible = !layout.hidden.includes(rail.id);
                return (
                  <div className="home-sections-card home-sections-row" key={rail.id} data-rail-id={rail.id}>
                    <span className="home-sections-text" style={{ opacity: visible ? 1 : 0.42 }}>
                      <strong>{rail.title}</strong>
                      <small>{rail.items.length} item{rail.items.length === 1 ? "" : "s"}</small>
                    </span>
                    {editing ? (
                      <>
                        <button data-tv-focusable="true" data-move="up" aria-label={`Move ${rail.title} earlier`} className="home-sections-button compact" disabled={index === 0} onClick={() => move(rail.id, -1)}><SettingsGlyph name="up" className="home-sections-icon" /></button>
                        <button data-tv-focusable="true" data-move="down" aria-label={`Move ${rail.title} later`} className="home-sections-button compact" disabled={index === arranged.length - 1} onClick={() => move(rail.id, 1)}><SettingsGlyph name="down" className="home-sections-icon" /></button>
                      </>
                    ) : null}
                    <button data-tv-focusable="true" aria-label={`${visible ? "Hide" : "Show"} ${rail.title}`} className="home-sections-button compact" onClick={() => toggle(rail.id)}><SettingsGlyph name={visible ? "eye" : "eyeoff"} className="home-sections-icon" /></button>
                  </div>
                );
              })}
            </div>
            <p className="home-sections-footer">{editing ? "Use the arrow buttons to move rows. The new order saves immediately." : "Open eye: visible on Home. Closed eye: hidden. Hidden rows leave no gap."}</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
