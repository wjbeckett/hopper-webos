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
  client: "Silo webOS",
  device: "LG webOS TV",
  version: "0.2.0-dev"
};
