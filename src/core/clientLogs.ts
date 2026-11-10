const ENABLED_KEY = "silo-webos-debug-logging";
const LOGS_KEY = "silo-webos-debug-logs";
const MAX_ENTRIES = 400;
const MAX_STORAGE_CHARS = 220_000;
const REDACT_KEY = /token|authorization|cookie|password|secret|email|profile|user(name)?|server(url|address)?|stream(url|headers)?|session|credential/i;
const URL_RE = /\bhttps?:\/\/\S+/gi;

type LogEntry = { at: string; level: string; message: string };

function enabled() {
  try { return localStorage.getItem(ENABLED_KEY) === "true"; } catch { return false; }
}

function safeValue(value: unknown, key = "", depth = 0): unknown {
  if (REDACT_KEY.test(key)) return "[redacted]";
  if (depth > 3) return "[truncated]";
  if (value instanceof Error) return { name: value.name, message: value.message.replace(URL_RE, "[URL]").slice(0, 1000) };
  if (typeof value === "string") return value.replace(URL_RE, "[URL]").replace(/\b(Bearer|Basic)\s+\S+/gi, "$1 [redacted]").slice(0, 1000);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(item => safeValue(item, "", depth + 1));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 30)) result[childKey] = safeValue(childValue, childKey, depth + 1);
    return result;
  }
  return String(value).slice(0, 300);
}

function readEntries(): LogEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOGS_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is LogEntry => Boolean(entry && typeof entry === "object" && typeof entry.at === "string" && typeof entry.level === "string" && typeof entry.message === "string")).slice(-MAX_ENTRIES)
      : [];
  } catch { return []; }
}

function append(level: string, message: string) {
  if (!enabled()) return;
  const entries = readEntries();
  entries.push({ at: new Date().toISOString(), level, message: message.slice(0, 3000) });
  let serialized = JSON.stringify(entries.slice(-MAX_ENTRIES));
  while (serialized.length > MAX_STORAGE_CHARS && entries.length > 1) {
    entries.shift();
    serialized = JSON.stringify(entries);
  }
  try { localStorage.setItem(LOGS_KEY, serialized); } catch { /* Storage may be unavailable or full. */ }
  window.dispatchEvent(new Event("silo-debug-log-updated"));
}

export function installClientLogCapture() {
  const target = console as Console & { __siloCaptureInstalled?: boolean };
  if (target.__siloCaptureInstalled) return;
  target.__siloCaptureInstalled = true;
  for (const level of ["debug", "info", "log", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      try {
        append(level, args.map(value => {
          try { return JSON.stringify(safeValue(value)); } catch { return '"[unavailable]"'; }
        }).join(" "));
      } catch { /* Diagnostics must never interfere with normal app logging. */ }
    };
  }
  window.addEventListener("error", event => append("error", JSON.stringify({
    message: event.message,
    file: event.filename.split("/").pop(),
    line: event.lineno,
    column: event.colno
  })));
  window.addEventListener("unhandledrejection", event => append("error", `Unhandled rejection: ${JSON.stringify(safeValue(event.reason))}`));
}

export function isDebugLoggingEnabled() { return enabled(); }
export function setDebugLoggingEnabled(value: boolean) {
  try { localStorage.setItem(ENABLED_KEY, String(value)); } catch { /* Keep the setting device-local. */ }
}
export function getClientLogEntries() { return readEntries(); }
export function getClientLogCount() { return readEntries().length; }
export function clearClientLogs() {
  try { localStorage.removeItem(LOGS_KEY); } catch { /* Storage may be unavailable. */ }
  window.dispatchEvent(new Event("silo-debug-log-updated"));
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date: Date) {
  return { time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2), date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate() };
}

function createZip(filename: string, content: string) {
  const encoder = new TextEncoder();
  const name = encoder.encode(filename);
  const data = encoder.encode(content);
  const crc = crc32(data);
  const stamp = dosTime(new Date());
  const local = new Uint8Array(30 + name.length + data.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
  lv.setUint16(8, 0, true); lv.setUint16(10, stamp.time, true); lv.setUint16(12, stamp.date, true);
  lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
  lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
  local.set(name, 30); local.set(data, 30 + name.length);
  const central = new Uint8Array(46 + name.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
  cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true); cv.setUint16(12, stamp.time, true); cv.setUint16(14, stamp.date, true);
  cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
  cv.setUint16(28, name.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
  cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, 0, true);
  central.set(name, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, 1, true); ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true); ev.setUint32(16, local.length, true);
  const zip = new Uint8Array(local.length + central.length + end.length);
  zip.set(local); zip.set(central, local.length); zip.set(end, local.length + central.length);
  return new Blob([zip], { type: "application/zip" });
}

export function exportClientLogs() {
  const entries = readEntries();
  if (!entries.length) return false;
  const metadata = { type: "export_metadata", client: "Hopper for webOS", platform: "webOS", exported_at: new Date().toISOString() };
  const lines = [JSON.stringify(metadata), ...entries.map(entry => JSON.stringify(entry))].join("\n") + "\n";
  const blob = createZip("debug-logs.jsonl", lines);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `silo-webos-debug-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}
