/**
 * The phones the viewer has allowed to control this TV (#162), by the deviceId each phone's
 * SiloControl hello carries. Kept on the TV only. Settings → Phone remote lists and forgets them.
 */
const STORAGE_KEY = "silo-webos-allowed-phones-v1";
const MAX_PHONES = 50;

export type AllowedPhone = { deviceId: string; name: string; allowedAt: number };

let cache: AllowedPhone[] | null = null;
const listeners = new Set<() => void>();

function read(): AllowedPhone[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    cache = Array.isArray(parsed)
      ? parsed.filter((entry): entry is AllowedPhone =>
        !!entry && typeof entry.deviceId === "string" && entry.deviceId !== "" && typeof entry.name === "string" && typeof entry.allowedAt === "number")
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(phones: AllowedPhone[]) {
  cache = phones;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(phones)); } catch { /* Storage may be unavailable; allowed for this run. */ }
  listeners.forEach(listener => listener());
}

export function allowedPhones(): AllowedPhone[] {
  return read();
}

export function isPhoneAllowed(deviceId: string) {
  return deviceId !== "" && read().some(phone => phone.deviceId === deviceId);
}

export function allowPhone(deviceId: string, name: string, now = Date.now()) {
  if (!deviceId) return;
  const others = read().filter(phone => phone.deviceId !== deviceId);
  write([...others, { deviceId, name: name.trim().slice(0, 120) || "Phone", allowedAt: now }].slice(-MAX_PHONES));
}

export function forgetPhone(deviceId: string) {
  write(read().filter(phone => phone.deviceId !== deviceId));
}

export function forgetAllPhones() {
  write([]);
}

export function subscribeAllowedPhones(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
