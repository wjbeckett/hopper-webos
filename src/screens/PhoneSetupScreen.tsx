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
 * "Enter server address" is the manual route (it ends in the QR sign-in).
 */
export function PhoneSetupScreen({
  onPaired,
  onManual
}: {
  onPaired: (session: Session) => void;
  onManual: () => void;
}) {
  const [status, setStatus] = useState("Looking for your phone…");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const attemptRef = useRef(0);

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
            onPaired(session);
            return;
          }
          if (result.status === "denied") { failure = "denied"; throw new Error("The request was declined."); }
          if (["expired", "consumed", "canceled"].includes(result.status)) { failure = "expired"; throw new Error("The code expired."); }
          interval = Math.max(1, result.poll_after ?? interval);
        }
      } catch (cause) {
        if (!current()) return;
        setCode("");
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
            else if (event.type === "message" && (event.message.type === "cancel" || event.message.type === "done")) attemptRef.current += 1;
            else if (event.type === "disconnected") attemptRef.current += 1;
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
  }, [onPaired]);

  return (
    <main className="login-shell server-setup">
      <section className="login-card wide-login-card">
        <div className="eyebrow">Hopper for LG webOS</div>
        <h1>Set up with your phone</h1>
        <p>Open Silo on your phone, choose “Sign in on TV”, then pick this TV. Nothing to type with the remote.</p>
        <p className="pair-status">{status}</p>
        {code ? <div className="pair-code">{code}</div> : null}
        {error ? <div className="error">{error}</div> : null}
        <TvButton onClick={onManual}>Enter server address</TvButton>
      </section>
    </main>
  );
}
