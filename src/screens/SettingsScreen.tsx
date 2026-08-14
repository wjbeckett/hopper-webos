import { probePlaybackCapabilities } from "../platform/capabilities";
import { TvButton } from "../components/TvButton";
import type { Session } from "../types";

export function SettingsScreen({
  session,
  onSignOut,
  onChangeServer
}: {
  session: Session;
  onSignOut: () => void;
  onChangeServer: () => void;
}) {
  const caps = probePlaybackCapabilities();

  return (
    <main className="content-screen settings-screen">
      <div className="screen-title">
        <div className="eyebrow">Profile & Device</div>
        <h1>{session.username}</h1>
      </div>

      <section className="settings-panel">
        <h2>Connected server</h2>
        <p>{session.serverUrl}</p>
      </section>

      <section className="settings-panel">
        <h2>This LG TV</h2>
        <div className="codec-list">
          {Object.entries(caps.codecs).map(([codec, supported]) => (
            <span key={codec} className={supported ? "codec yes" : "codec no"}>
              {codec.toUpperCase()} {supported ? "✓" : "×"}
            </span>
          ))}
        </div>
      </section>

      <div className="settings-actions">
        <TvButton onClick={onChangeServer}>Switch / add server</TvButton>
        <TvButton className="secondary" onClick={onSignOut}>Sign out</TvButton>
      </div>
    </main>
  );
}
