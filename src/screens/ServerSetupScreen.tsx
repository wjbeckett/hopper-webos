import { useState } from "react";
import { serverRegistry } from "../core/serverRegistry";
import { TvButton } from "../components/TvButton";

export function ServerSetupScreen({
  onContinue
}: {
  onContinue: (serverUrl: string) => void;
}) {
  const [serverUrl, setServerUrl] = useState(import.meta.env.DEV ? "/__silo" : "");
  const servers = serverRegistry.all();

  function submit() {
    const normalized = serverUrl.trim().replace(/\/+$/, "");
    if (normalized) onContinue(normalized);
  }

  return (
    <main className="login-shell server-setup">
      <section className="login-card wide-login-card">
        <div className="eyebrow">Silo for LG webOS</div>
        <h1>Choose your server</h1>
        <p>Pair this TV with an existing Silo installation.</p>

        {servers.length ? (
          <div className="server-list">
            {servers.map((server) => (
              <button
                data-tv-focusable="true"
                className="server-row"
                key={server.id}
                onClick={() => onContinue(server.url)}
              >
                <span>
                  <strong>{server.name}</strong>
                  <small>{server.url}</small>
                </span>
                <b>{server.session ? "Ready" : "Sign in"}</b>
              </button>
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
    </main>
  );
}
