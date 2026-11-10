import { useState } from "react";
import { setupServer } from "../api/silo";
import { TvButton } from "../components/TvButton";
import type { Session } from "../types";

/** Android TvSetupViewModel.validateFields, same order and wording. */
function validate(username: string, email: string, password: string): string | null {
  if (!username.trim()) return "Username is required";
  if (!email.trim()) return "Email is required";
  if (!email.includes("@")) return "Please enter a valid email address";
  if (!password) return "Password is required";
  if (password.length < 8) return "Password must be at least 8 characters";
  return null;
}

/**
 * First-run setup (Android TvSetupScreen): shown only when the server reports
 * `needs_setup`. Creates the first account, which becomes the admin, and signs in.
 */
export function FirstRunSetupScreen({ serverUrl, onComplete, onChangeServer }: {
  serverUrl: string;
  onComplete: (session: Session) => void;
  onChangeServer: () => void;
}) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    const invalid = validate(username, email, password);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError("");
    try {
      onComplete(await setupServer(serverUrl, username, email, password));
    } catch (cause) {
      setError(cause instanceof TypeError ? "Network error. Please check your connection." : cause instanceof Error ? cause.message : "Setup failed");
      setBusy(false);
    }
  }

  // Each field clears the error as you type, as Android's on*Changed handlers do.
  const edit = (setter: (value: string) => void) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setter(event.target.value);
    setError("");
  };

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="eyebrow">The first account</div>
        <h1>Set up your server</h1>
        <p>This server has no accounts yet. Create the first one; it becomes the admin.</p>

        <label>
          Username
          <input data-tv-focusable="true" autoFocus value={username} onChange={edit(setUsername)} autoComplete="username" />
        </label>
        <label>
          Email
          <input data-tv-focusable="true" type="email" value={email} onChange={edit(setEmail)} autoComplete="email" />
        </label>
        <label>
          Password
          <input
            data-tv-focusable="true"
            type="password"
            value={password}
            onChange={edit(setPassword)}
            onKeyDown={event => { if (event.key === "Enter") void submit(); }}
            autoComplete="new-password"
          />
        </label>

        {error ? <div className="error" role="alert">{error}</div> : null}
        <small className="profile-form-caption">It runs the server. Add more accounts later from the web admin.</small>

        <div className="pair-actions">
          <TvButton onClick={() => void submit()} disabled={busy}>
            {busy ? "Creating account…" : "Create account"}
          </TvButton>
          <TvButton className="secondary" onClick={onChangeServer}>
            Change server
          </TvButton>
        </div>
      </section>
    </main>
  );
}
