import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  clearPendingDeviceLogin,
  getOrStartDeviceLogin,
  pollDeviceLogin,
  sessionFromApprovedDeviceLogin,
  type DeviceLoginStart
} from "../api/deviceLogin";
import { TvButton } from "../components/TvButton";
import type { Session } from "../types";

type Props = {
  serverUrl: string;
  /** Why the viewer is back here, when the server ended their sign-in. */
  notice?: string;
  onLogin: (session: Session) => void;
  onPasswordLogin: () => void;
  onChangeServer: () => void;
};

export function DeviceLoginScreen({
  serverUrl,
  notice,
  onLogin,
  onPasswordLogin,
  onChangeServer
}: Props) {
  const [pairing, setPairing] = useState<DeviceLoginStart | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Creating sign-in code…");
  const [attempt, setAttempt] = useState(0);
  const stopped = useRef(false);

  const displayCode = useMemo(
    () => pairing?.user_code || pairing?.match_code || "",
    [pairing]
  );

  useEffect(() => {
    stopped.current = false;
    let timer: number | undefined;

    async function begin() {
      setError("");
      setStatus("Creating sign-in code…");

      try {
        if (attempt > 0) clearPendingDeviceLogin(serverUrl);
        const started = await getOrStartDeviceLogin(serverUrl);
        if (stopped.current) return;

        setPairing(started);
        setStatus("Waiting for approval…");

        try {
          setQrDataUrl(
            await QRCode.toDataURL(started.verification_uri_complete, {
              width: 360,
              margin: 2,
              errorCorrectionLevel: "M"
            })
          );
        } catch {
          setQrDataUrl("");
        }

        const parsedExpiry = Date.parse(started.expires_at);
        const expiresAt = Number.isFinite(parsedExpiry)
          ? parsedExpiry
          : Date.now() + Math.max(1, started.expires_in) * 1000;
        let intervalSeconds = Math.max(1, started.interval || 5);

        const poll = async () => {
          if (stopped.current) return;

          if (Date.now() >= expiresAt) {
            setStatus("Code expired");
            setError("This sign-in code expired. Create a new one to continue.");
            return;
          }

          try {
            const result = await pollDeviceLogin(serverUrl, started.device_code);
            if (stopped.current) return;
            // A failed check (network loss) is retried; once one gets through, its message goes.
            setError("");

            if (result.status === "approved") {
              // Important: Silo returns tokens only on this single approved poll.
              // Capture immediately before doing any other work.
              const session = sessionFromApprovedDeviceLogin(serverUrl, result);
              clearPendingDeviceLogin(serverUrl);
              setStatus("Approved");
              onLogin(session);
              return;
            }

            if (result.status === "denied") {
              clearPendingDeviceLogin(serverUrl);
              setStatus("Sign-in denied");
              setError("The sign-in request was denied on the other device.");
              return;
            }

            if (result.status === "expired" || result.status === "consumed" || result.status === "canceled") {
              clearPendingDeviceLogin(serverUrl);
              setStatus("Code expired");
              setError("This sign-in code is no longer valid. Create a new one.");
              return;
            }

            intervalSeconds = Math.max(
              1,
              result.poll_after ?? intervalSeconds
            );
            timer = window.setTimeout(poll, intervalSeconds * 1000);
          } catch (err) {
            if (stopped.current) return;
            setError(err instanceof Error ? err.message : "Could not check sign-in status.");
            timer = window.setTimeout(poll, Math.max(5, intervalSeconds) * 1000);
          }
        };

        timer = window.setTimeout(poll, intervalSeconds * 1000);
      } catch (err) {
        if (stopped.current) return;
        setStatus("Could not create code");
        setError(err instanceof Error ? err.message : "Device sign-in is unavailable.");
      }
    }

    begin();

    return () => {
      stopped.current = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [serverUrl, onLogin, attempt]);

  return (
    <main className="pair-shell">
      <section className="pair-card">
        <div className="pair-copy">
          <div className="eyebrow">Sign in to Silo</div>
          <h1>Use another device</h1>
          {notice ? <div className="signed-out-notice" role="status">{notice}</div> : null}
          <p className="pair-intro">
            Scan the QR code with your phone, or open the address shown below and enter the code.
          </p>

          {displayCode ? (
            <div className="pair-code" aria-label={`Sign-in code ${displayCode}`}>
              {displayCode}
            </div>
          ) : (
            <div className="pair-code pair-code-loading">•••• ••••</div>
          )}

          <div className="pair-status">
            <span className={status === "Approved" ? "status-dot approved" : "status-dot"} />
            {status}
          </div>

          {pairing?.verification_uri ? (
            <div className="pair-url">{pairing.verification_uri}</div>
          ) : null}

          {error ? <div className="error">{error}</div> : null}

          <div className="pair-actions">
            {error ? (
              <TvButton onClick={() => setAttempt((value) => value + 1)}>
                New code
              </TvButton>
            ) : null}
            <TvButton className="secondary" onClick={onPasswordLogin}>
              Use password instead
            </TvButton>
            <TvButton className="secondary" onClick={onChangeServer}>
              Change server
            </TvButton>
          </div>
        </div>

        <div className="qr-panel">
          {qrDataUrl ? (
            <img className="qr-image" src={qrDataUrl} alt="Silo device sign-in QR code" />
          ) : (
            <div className="qr-placeholder">QR</div>
          )}
          <div className="qr-caption">
            Approve this LG TV from an authenticated Silo app or browser.
          </div>
        </div>
      </section>
    </main>
  );
}
