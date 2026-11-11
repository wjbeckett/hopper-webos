/**
 * Whether the Silo server can be reached, and when a sign-in has ended.
 *
 * Every request to the signed-in server goes through `serverFetch`. A request that fails
 * before any answer arrives (no network, server down) makes this module check the server
 * itself. If that check fails too, the server counts as unreachable and is checked again
 * every few seconds until it answers. The UI listens here to show the connection-lost
 * state and to load screens again afterwards. One failed request does not count as an
 * outage, so a single dropped request never interrupts the viewer.
 *
 * Follows Android's ServerReachabilityMonitor (probe interval while unreachable) and
 * TokenManager.sessionExpired (a refused refresh token signs the viewer out).
 */

export const NETWORK_ERROR_MESSAGE = "Can't reach the server. Check this TV's network connection.";

/** A request got no answer at all. Its message is fit to show to a viewer. */
export class NetworkError extends Error {
  constructor() {
    super(NETWORK_ERROR_MESSAGE);
    this.name = "NetworkError";
  }
}

export type ConnectionStatus = "reachable" | "unreachable";

type Listener = () => void;

const PROBE_TIMEOUT_MS = 6_000;
/** Android ServerReachabilityMonitor.UNREACHABLE_PROBE_INTERVAL_MS. */
const UNREACHABLE_PROBE_INTERVAL_MS = 8_000;
/** A dropped request with the server still up reloads the screen at most this often. */
const BLIP_RELOAD_INTERVAL_MS = 30_000;

let watchedUrl = "";
let status: ConnectionStatus = "reachable";
/** A read (GET) failed since the last successful check, so a screen may be showing an error. */
let readFailed = false;
let lastBlipReload = 0;
let probing: Promise<boolean> | null = null;
let timer: number | undefined;
let holds = 0;
let installed = false;
const statusListeners = new Set<Listener>();
const reloadListeners = new Set<Listener>();
const holdListeners = new Set<Listener>();
const expiryListeners = new Set<(serverUrl: string) => void>();

const normalize = (url: string) => url.trim().replace(/\/+$/, "");

function probe(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  // Public endpoint: it answers without a sign-in, so an expired session cannot look like an outage.
  return fetch(`${url}/api/v2/system/setup`, { headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal })
    .then(response => response.ok, () => false)
    .finally(() => window.clearTimeout(timeout));
}

function scheduleProbe() {
  if (timer !== undefined) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = undefined;
    // In the background nothing is shown; the check runs again when the app is visible.
    if (document.visibilityState === "hidden") scheduleProbe();
    else void checkConnection();
  }, UNREACHABLE_PROBE_INTERVAL_MS);
}

function setStatus(next: ConnectionStatus) {
  if (status === next) return;
  status = next;
  if (timer !== undefined) window.clearTimeout(timer);
  timer = undefined;
  if (next === "unreachable") scheduleProbe();
  [...statusListeners].forEach(listener => listener());
}

function install() {
  if (installed) return;
  installed = true;
  const recheck = () => { if (watchedUrl) void checkConnection(); };
  window.addEventListener("online", recheck);
  window.addEventListener("offline", recheck);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && status === "unreachable") recheck();
  });
}

/** Sets the server whose reachability is tracked: the signed-in one, or "" for none. */
export function watchServer(serverUrl: string) {
  install();
  const next = normalize(serverUrl);
  if (next === watchedUrl) return;
  watchedUrl = next;
  readFailed = false;
  setStatus("reachable");
}

/** Asks the server now. Resolves true when it answers. */
export function checkConnection(): Promise<boolean> {
  if (!watchedUrl) return Promise.resolve(true);
  if (probing) return probing;
  const url = watchedUrl;
  const current = probe(url).then(ok => {
    probing = null;
    if (url !== watchedUrl) return ok;
    const wasUnreachable = status === "unreachable";
    if (!ok) {
      if (wasUnreachable) scheduleProbe();
      else setStatus("unreachable");
      return false;
    }
    setStatus("reachable");
    const now = Date.now();
    const reload = readFailed && (wasUnreachable || now - lastBlipReload > BLIP_RELOAD_INTERVAL_MS);
    readFailed = false;
    if (reload) {
      if (!wasUnreachable) lastBlipReload = now;
      [...reloadListeners].forEach(listener => listener());
    }
    return true;
  });
  probing = current;
  return current;
}

function noteRequestFailed(serverUrl: string, read: boolean) {
  if (!watchedUrl || normalize(serverUrl) !== watchedUrl) return;
  if (read) readFailed = true;
  // Already known to be down: the timed check is running.
  if (status === "reachable") void checkConnection();
}

/**
 * `fetch` for a request to a Silo server. No answer at all becomes a `NetworkError`, and for
 * the signed-in server it also starts a reachability check.
 */
export async function serverFetch(serverUrl: string, url: string, init?: RequestInit): Promise<Response> {
  const read = !init?.method || init.method.toUpperCase() === "GET";
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    noteRequestFailed(serverUrl, read);
    throw new NetworkError();
  }
  // A proxy in front of a server that is down answers for it with one of these.
  if (response.status === 502 || response.status === 503 || response.status === 504) noteRequestFailed(serverUrl, read);
  return response;
}

/** For code that loads from the server by other means (the video player) and saw the network fail. */
export function reportNetworkFailure(serverUrl: string) {
  noteRequestFailed(serverUrl, false);
}

export function connectionStatus(): ConnectionStatus {
  return status;
}

export function subscribeConnection(listener: Listener): () => void {
  statusListeners.add(listener);
  return () => { statusListeners.delete(listener); };
}

/** Called when the server answers again after a screen's load failed: load the screen again. */
export function subscribeReload(listener: Listener): () => void {
  reloadListeners.add(listener);
  return () => { reloadListeners.delete(listener); };
}

/**
 * Calls back once, when the server next answers a check. Returns a function that cancels it.
 * The check starts at once, so with the server already up the callback follows shortly.
 */
export function onceReachable(callback: () => void): () => void {
  let done = false;
  const finish = () => {
    if (done || status !== "reachable") return;
    done = true;
    statusListeners.delete(finish);
    callback();
  };
  statusListeners.add(finish);
  void checkConnection().then(ok => { if (ok) finish(); });
  return () => { done = true; statusListeners.delete(finish); };
}

/** The player shows its own connection-lost state; while it holds, the browsing dialog stays away. */
export function holdConnectionDialog(): () => void {
  holds++;
  [...holdListeners].forEach(listener => listener());
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
    [...holdListeners].forEach(listener => listener());
  };
}

export function connectionDialogHeld(): boolean {
  return holds > 0;
}

export function subscribeDialogHold(listener: Listener): () => void {
  holdListeners.add(listener);
  return () => { holdListeners.delete(listener); };
}

/** The server refused this sign-in for good (its refresh token was rejected). */
export function publishSessionExpired(serverUrl: string) {
  const url = normalize(serverUrl);
  [...expiryListeners].forEach(listener => listener(url));
}

export function subscribeSessionExpired(listener: (serverUrl: string) => void): () => void {
  expiryListeners.add(listener);
  return () => { expiryListeners.delete(listener); };
}
