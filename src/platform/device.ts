const STORAGE_KEY = "silo-webos-device-id";

export function getDeviceId(): string {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;

  const generated =
    globalThis.crypto?.randomUUID?.() ??
    `webos-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  localStorage.setItem(STORAGE_KEY, generated);
  return generated;
}

export const clientIdentity = {
  client: "Hopper for webOS",
  device: "LG webOS TV",
  /** Stamped at build time: <major>.<minor>.<commit count>. */
  version: __APP_VERSION__,
  /** Short commit hash of the build. Empty when built without git. */
  commit: __APP_COMMIT__
};
