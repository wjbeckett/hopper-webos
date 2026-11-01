import type { DiagnosticsCapabilities } from "../api/diagnostics";

export type DiagnosticsConsent = "ask" | "always" | "never";
export type DiagnosticsAvailability = "available" | "disabled" | "storage_unavailable" | "offline" | "ineligible";
export type SentReport = { shortId: string; sentAt: number };

const KEY = "silo-webos-diagnostics-v1";
type Stored = { consent: DiagnosticsConsent; debugLogging: boolean; sent: SentReport[] };

function read(): Stored {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Stored>;
    return {
      consent: value.consent === "always" || value.consent === "never" ? value.consent : "ask",
      debugLogging: Boolean(value.debugLogging),
      sent: Array.isArray(value.sent) ? value.sent : []
    };
  } catch {
    return { consent: "ask", debugLogging: false, sent: [] };
  }
}

function write(next: Stored) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage full */ }
}

export const readDiagnosticsSettings = read;
export function writeConsent(consent: DiagnosticsConsent) {
  const current = read();
  write({ ...current, consent, debugLogging: consent === "never" ? false : current.debugLogging });
}
export function writeDebugLogging(enabled: boolean) {
  const current = read();
  write({ ...current, debugLogging: enabled && current.consent !== "never" });
}

export function availabilityFor(capabilities: DiagnosticsCapabilities | null, eligible: boolean): DiagnosticsAvailability {
  if (!eligible) return "ineligible";
  if (!capabilities) return "offline";
  if (capabilities.status === "available" && capabilities.allowed) return "available";
  if (capabilities.status === "storage_unavailable") return "storage_unavailable";
  return "disabled";
}

export const statusTitle: Record<DiagnosticsAvailability, string> = {
  available: "Available",
  disabled: "Disabled by server",
  storage_unavailable: "Storage unavailable",
  offline: "Offline",
  ineligible: "Unavailable"
};

export const consentTitle: Record<DiagnosticsConsent, string> = { ask: "Ask", always: "Always", never: "Never" };

export function formatShortDateTime(epochMs: number) {
  return new Date(epochMs).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}
