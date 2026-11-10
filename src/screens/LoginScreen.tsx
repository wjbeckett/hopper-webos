import { useEffect, useState } from "react";
import { authenticate, getSignupStatus } from "../api/silo";
import { TvButton } from "../components/TvButton";
import type { Session } from "../types";

type Props = {
  serverUrl: string;
  onLogin: (session: Session) => void;
  onDeviceLogin: () => void;
  onCreateAccount: () => void;
  onChangeServer: () => void;
};

export function LoginScreen({
  serverUrl,
  onLogin,
  onDeviceLogin,
  onCreateAccount,
  onChangeServer
}: Props) {
  const [username, setUsername] = useState(localStorage.getItem("silo-username") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signupEnabled, setSignupEnabled] = useState(false);

  // Android offers "Create account" only when the server reports invite sign-ups enabled
  // (TvServerSetupViewModel probes it; a failed probe leaves the button out).
  useEffect(() => {
    let alive = true;
    setSignupEnabled(false);
    getSignupStatus(serverUrl).then(enabled => { if (alive) setSignupEnabled(enabled); }).catch(() => undefined);
    return () => { alive = false; };
  }, [serverUrl]);

  async function submit() {
    setBusy(true);
    setError("");

    try {
      const session = await authenticate(serverUrl, username, password);
      localStorage.setItem("silo-username", session.username);
      onLogin(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="eyebrow">Password sign-in</div>
        <h1>Hopper</h1>
        <p>{serverUrl}</p>

        <label>
          Username
          <input
            data-tv-focusable="true"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </label>

        <label>
          Password
          <input
            data-tv-focusable="true"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            autoComplete="current-password"
          />
        </label>

        {error ? <div className="error">{error}</div> : null}

        <div className="pair-actions">
          <TvButton onClick={submit} disabled={busy || !username}>
            {busy ? "Connecting…" : "Sign in"}
          </TvButton>
          {signupEnabled ? (
            <TvButton className="secondary" onClick={onCreateAccount}>
              Create account
            </TvButton>
          ) : null}
          <TvButton className="secondary" onClick={onDeviceLogin}>
            Use another device
          </TvButton>
          <TvButton className="secondary" onClick={onChangeServer}>
            Change server
          </TvButton>
        </div>
      </section>
    </main>
  );
}
