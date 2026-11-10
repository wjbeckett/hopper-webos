import { useEffect, useState } from "react";
import { signUp } from "../api/silo";
import { TvButton } from "../components/TvButton";
import type { Session } from "../types";

/** Android TvSignupViewModel.validateFields, same order and wording. */
function validate(username: string, email: string, password: string, inviteCode: string): string | null {
  if (!username.trim()) return "Username is required";
  if (!email.trim()) return "Email is required";
  if (!email.includes("@")) return "Please enter a valid email address";
  if (!password) return "Password is required";
  if (password.length < 8) return "Password must be at least 8 characters";
  if (!inviteCode.trim()) return "Invite code is required";
  return null;
}

/**
 * Invite-code sign-up (Android TvSignupScreen): reached from password sign-in when the
 * server reports sign-ups enabled. Creates the account and signs in; Back or
 * "Sign in instead" returns to sign-in.
 */
export function SignupScreen({ serverUrl, onComplete, onBackToLogin }: {
  serverUrl: string;
  onComplete: (session: Session) => void;
  onBackToLogin: () => void;
}) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Back returns to sign-in, except while a request is in flight (Android's BackHandler)
  // or while a text field has focus, where the remote's Back belongs to the keyboard.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.keyCode !== 461 && event.keyCode !== 10009) return;
      if (document.activeElement instanceof HTMLInputElement) return;
      event.preventDefault();
      if (!busy) onBackToLogin();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onBackToLogin]);

  async function submit() {
    if (busy) return;
    const invalid = validate(username, email, password, inviteCode);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError("");
    try {
      onComplete(await signUp(serverUrl, username, email, password, inviteCode));
    } catch (cause) {
      setError(cause instanceof TypeError ? "Network error. Please check your connection." : cause instanceof Error ? cause.message : "Signup failed");
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
        <div className="eyebrow">Invite sign-up</div>
        <h1>Create your account</h1>
        <p>Join this Silo server with your invite.</p>

        <label>
          Username
          <input data-tv-focusable="true" autoFocus value={username} onChange={edit(setUsername)} disabled={busy} autoComplete="username" />
        </label>
        <label>
          Email
          <input data-tv-focusable="true" type="email" value={email} onChange={edit(setEmail)} disabled={busy} autoComplete="email" />
        </label>
        <label>
          Password
          <input data-tv-focusable="true" type="password" value={password} onChange={edit(setPassword)} disabled={busy} autoComplete="new-password" />
        </label>
        <label>
          Invite code
          <input
            data-tv-focusable="true"
            value={inviteCode}
            onChange={edit(setInviteCode)}
            onKeyDown={event => { if (event.key === "Enter") void submit(); }}
            disabled={busy}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </label>

        {error ? <div className="error" role="alert">{error}</div> : null}

        <div className="pair-actions">
          <TvButton onClick={() => void submit()} disabled={busy}>
            {busy ? "Creating account…" : "Create account"}
          </TvButton>
          <TvButton className="secondary" onClick={onBackToLogin} disabled={busy}>
            Sign in instead
          </TvButton>
        </div>
      </section>
    </main>
  );
}
