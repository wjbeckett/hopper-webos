import { useEffect, useRef, useState } from "react";
import { pollDeviceLogin, sessionFromApprovedDeviceLogin, startDeviceLogin } from "../api/deviceLogin";
import { TvButton } from "../components/TvButton";
import { getDeviceId } from "../platform/device";
import {
  closePairingConnection,
  pairingAvailable,
  pollPairing,
  sendPairingMessage,
  startPairing,
  stopPairing,
  type PairingMessage
} from "../platform/pairing";
import type { Session } from "../types";

type Push = Extract<PairingMessage, { type: "pushServer" }>;

/**
 * First screen on a TV with no server (Android TvServerSetupScreen, phone-first):
 * advertises this TV so the Silo phone app can push its server, then runs the
 * device login against that server and reports the result to the phone.
 * The button is the manual route: the server's address when none is saved, then QR sign-in.
 * It is also the first screen after a sign-out, with the server still saved.
 */
export function PhoneSetupScreen({
  notice,
  manualLabel = "Enter server address",
  onPaired,
  onManual
}: {
  /** Why the TV is signed out, when the server ended the sign-in. */
  notice?: string;
  manualLabel?: string;
  onPaired: (session: Session) => void;
  onManual: () => void;
}) {
  const [status, setStatus] = useState("Looking for your phone…");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  /** True from the phone's push until that attempt ends: the user is now finishing on the phone. */
  const [attemptActive, setAttemptActive] = useState(false);
  const attemptRef = useRef(0);
  // The caller passes a new function on every render. Pairing must not restart for that: a
  // restart stops and starts the TV's advertisement, and the phone loses the TV.
  const onPairedRef = useRef(onPaired);
  onPairedRef.current = onPaired;

  useEffect(() => {
    if (!pairingAvailable()) {
      setStatus("Phone pairing is only available on the TV.");
      return;
    }
    let alive = true;
    let since = 0;
    let timer: number | undefined;

    const sleep = (ms: number) => new Promise<void>(resolve => { window.setTimeout(resolve, ms); });

    // One push at a time; a newer push (or a cancel) bumps attemptRef and
    // makes the older attempt stop quietly.
    async function runAttempt(push: Push) {
      const attempt = ++attemptRef.current;
      const current = () => alive && attemptRef.current === attempt;
      setError("");
      setCode("");
      setAttemptActive(true);
      setStatus("Connecting to your server…");
      let failure = "auth_failed";
      try {
        let started;
        try {
          started = await startDeviceLogin(push.serverURL);
        } catch {
          failure = "unreachable";
          throw new Error("Couldn't reach that server from this TV.");
        }
        if (!current()) return;
        setCode(started.user_code);
        setStatus("Confirm the code on your phone");
        await sendPairingMessage({
          type: "deviceStarted",
          serverURL: push.serverURL,
          userCode: started.user_code,
          matchCode: started.match_code
        });

        const expiresAt = Date.parse(started.expires_at) || Date.now() + started.expires_in * 1000;
        let interval = Math.max(1, started.interval || 5);
        while (current()) {
          if (Date.now() >= expiresAt) { failure = "expired"; throw new Error("The code expired."); }
          await sleep(interval * 1000);
          if (!current()) return;
          const result = await pollDeviceLogin(push.serverURL, started.device_code);
          if (!current()) return;
          if (result.status === "approved") {
            const session = sessionFromApprovedDeviceLogin(push.serverURL, result);
            await sendPairingMessage({ type: "serverResult", serverURL: push.serverURL, status: "signedIn" }).catch(() => undefined);
            await closePairingConnection();
            await stopPairing();
            onPairedRef.current(session);
            return;
          }
          if (result.status === "denied") { failure = "denied"; throw new Error("The request was declined."); }
          if (["expired", "consumed", "canceled"].includes(result.status)) { failure = "expired"; throw new Error("The code expired."); }
          interval = Math.max(1, result.poll_after ?? interval);
        }
      } catch (cause) {
        if (!current()) return;
        setCode("");
        setAttemptActive(false);
        setStatus("Looking for your phone…");
        setError(cause instanceof Error ? cause.message : "Pairing failed.");
        await sendPairingMessage({ type: "serverResult", serverURL: push.serverURL, status: "failed", error: failure }).catch(() => undefined);
        await closePairingConnection();
      }
    }

    async function loop() {
      try {
        await startPairing("LG webOS TV", getDeviceId());
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : "Couldn't start phone pairing.");
        return;
      }
      const tick = async () => {
        if (!alive) return;
        try {
          const reply = await pollPairing(since);
          for (const event of reply.events) {
            since = Math.max(since, event.seq);
            if (event.type === "message" && event.message.type === "pushServer") void runAttempt(event.message as Push);
            else if ((event.type === "message" && (event.message.type === "cancel" || event.message.type === "done")) || event.type === "disconnected") {
              // The phone stopped or went away: drop the attempt and go back to waiting,
              // so a stale code and "finishing" state don't stay on screen.
              attemptRef.current += 1;
              setCode("");
              setAttemptActive(false);
              setStatus("Looking for your phone…");
            }
          }
        } catch { /* keep polling; the service may be restarting */ }
        timer = window.setTimeout(tick, 1000);
      };
      void tick();
    }

    void loop();
    return () => {
      alive = false;
      attemptRef.current += 1;
      if (timer) window.clearTimeout(timer);
      void stopPairing();
    };
  }, []);

  return (
    <main className="login-shell server-setup">
      <section className="login-card phone-setup-card">
        <div className="phone-setup-copy">
          <div className="eyebrow">Hopper for LG webOS</div>
          <h1>Set up with your phone</h1>
          {notice ? <div className="signed-out-notice" role="status">{notice}</div> : null}
          <p>It's the easiest way. There's nothing to type with the remote.</p>
          <p className="pair-status">{status}</p>
          {code ? <div className="pair-code">{code}</div> : null}
          {error ? <div className="error">{error}</div> : null}
          <p className="phone-setup-alt">No phone nearby?</p>
          <TvButton onClick={onManual}>{manualLabel}</TvButton>
        </div>
        <SetupSteps finishing={attemptActive} />
      </section>
    </main>
  );
}

/**
 * How to set the TV up from a phone: three numbered steps, each with a small picture of
 * that action (Android `TvMarqueeSetupSteps`). The wording matches what the Silo phone app
 * shows: a "Set up" card for a nearby TV, then a code to confirm. Once the phone has
 * started, the first two steps dim and the last one is marked.
 */
function SetupSteps({ finishing }: { finishing: boolean }) {
  return (
    <ol className={`setup-steps ${finishing ? "finishing" : ""}`} aria-label="How to set up with your phone">
      <li className="setup-step">
        <span className="setup-step-tile">
          <b className="setup-step-number">1</b>
          <svg className="setup-step-phone" viewBox="0 0 60 96" aria-hidden="true" focusable="false">
            <rect x="3" y="3" width="54" height="90" rx="11" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.7)" strokeWidth="3" />
            <rect x="24" y="9" width="12" height="3" rx="1.5" fill="rgba(255,255,255,.45)" />
            <rect x="16" y="32" width="28" height="28" rx="7" fill="#2DD4BF" />
            <path d="M26 39.5v13l11-6.5z" fill="#0E1030" />
          </svg>
        </span>
        <span className="setup-step-title">Open Silo on your phone</span>
      </li>
      <li className="setup-step">
        <span className="setup-step-tile">
          <b className="setup-step-number">2</b>
          <span className="setup-step-card" aria-hidden="true">
            <i /><i />
            <em>Set up</em>
          </span>
        </span>
        <span className="setup-step-title">Tap Set up</span>
      </li>
      <li className="setup-step setup-step-last">
        <span className="setup-step-tile">
          <b className="setup-step-number">3</b>
          <svg className="setup-step-done" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
            <circle cx="24" cy="24" r="22" fill="rgba(127,227,161,.16)" stroke="#7fe3a1" strokeWidth="2.5" />
            <path d="M14.5 24.5l6.5 6.5 12.5-13.5" fill="none" stroke="#7fe3a1" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="setup-step-title">Finish on your phone</span>
      </li>
    </ol>
  );
}
