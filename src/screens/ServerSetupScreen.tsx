import { useEffect, useState } from "react";
import { serverRegistry } from "../core/serverRegistry";
import { TvButton } from "../components/TvButton";

export function ServerSetupScreen({
  onContinue
}: {
  onContinue: (serverUrl: string) => void;
}) {
  const [serverUrl, setServerUrl] = useState(import.meta.env.DEV ? "/__silo" : "");
  const [servers, setServers] = useState(() => serverRegistry.all());
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const activeId = serverRegistry.active()?.id;
  const target = servers.find(server => server.id === confirmRemove);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!["Escape", "Backspace", "Back", "GoBack", "BrowserBack"].includes(event.key) && event.keyCode !== 461 && event.keyCode !== 10009) return;
      if ((event.target as HTMLElement | null)?.tagName === "INPUT" && event.key === "Backspace") return;
      if (confirmRemove) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setConfirmRemove(null);
        return;
      }
      const active = serverRegistry.active();
      if (active) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onContinue(active.url);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [confirmRemove, onContinue]);

  function remove(id: string) {
    serverRegistry.remove(id);
    setServers(serverRegistry.all());
    setConfirmRemove(null);
  }

  function submit() {
    const normalized = serverUrl.trim().replace(/\/+$/, "");
    if (normalized) onContinue(normalized);
  }

  return (
    <main className="login-shell server-setup">
      <section className="login-card wide-login-card">
        <div className="eyebrow">Hopper for LG webOS</div>
        <h1>Choose your server</h1>
        <p>Pair this TV with an existing Silo installation.</p>

        {servers.length ? (
          <div className="server-list">
            {servers.map((server) => (
              <div className="server-row-group" key={server.id}>
                <button
                  data-tv-focusable="true"
                  className="server-row"
                  aria-current={server.id === activeId ? "true" : undefined}
                  onClick={() => onContinue(server.url)}
                >
                  <span>
                    <strong>{server.name}</strong>
                    <small>{server.url}</small>
                  </span>
                  <b>{server.id === activeId ? "Active" : server.session ? "Ready" : "Sign in"}</b>
                </button>
                <button
                  data-tv-focusable="true"
                  className="server-row server-row-remove"
                  aria-label={`Remove ${server.name}`}
                  onClick={() => setConfirmRemove(server.id)}
                >
                  <b>Remove</b>
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <label>
          Add server
          <input
            data-tv-focusable="true"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="https://silo.example.com"
            autoComplete="url"
          />
        </label>
        <TvButton onClick={submit} disabled={!serverUrl.trim()}>Continue</TvButton>
      </section>
      {target ? (
        <div className="details-more-scrim" data-modal="true" onClick={() => setConfirmRemove(null)}>
          <div className="details-more" role="dialog" aria-label="Remove server" onClick={event => event.stopPropagation()}>
            <h2>{target.id === activeId ? `Sign out & remove ${target.name}?` : `Remove ${target.name}?`}</h2>
            <button type="button" data-tv-focusable="true" autoFocus className="browse-panel-row" onClick={() => remove(target.id)}>
              <span>{target.id === activeId ? "Sign out & remove" : "Remove"}</span>
            </button>
            <button type="button" data-tv-focusable="true" className="browse-panel-row" onClick={() => setConfirmRemove(null)}>
              <span>Cancel</span>
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
