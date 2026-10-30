import type { Session } from "../types";

export type DeviceLoginStart = {
  device_code: string;
  user_code: string;
  match_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_at: string;
  expires_in: number;
  interval: number;
  device_name: string;
  device_platform: string;
};

export type DeviceLoginPoll = {
  status: "pending" | "approved" | "denied" | "expired" | "consumed" | string;
  poll_after?: number;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: {
    id?: string;
    Id?: string;
    username?: string;
    name?: string;
    Name?: string;
  };
  profile_id?: string;
  profile_token?: string;
  temporary?: boolean;
  session_expires_at?: string;
};

const PAIRING_KEY_PREFIX = "silo-webos-pairing-v1:";
const pendingStarts = new Map<string, Promise<DeviceLoginStart>>();

function normalizeServerUrl(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

async function jsonRequest<T>(
  serverUrl: string,
  path: string,
  init: RequestInit
): Promise<T> {
  const response = await fetch(`${normalizeServerUrl(serverUrl)}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText}${body ? `: ${body}` : ""}`);
  }

  return response.json() as Promise<T>;
}

export async function startDeviceLogin(
  serverUrl: string,
  deviceName = "LG webOS TV"
): Promise<DeviceLoginStart> {
  return jsonRequest<DeviceLoginStart>(
    serverUrl,
    "/api/v2/auth/device/start",
    {
      method: "POST",
      body: JSON.stringify({
        device_name: deviceName,
        device_platform: "webOS"
      })
    }
  );
}

function pairingKey(serverUrl: string) {
  return `${PAIRING_KEY_PREFIX}${normalizeServerUrl(serverUrl)}`;
}

function pairingExpiresAt(pairing: DeviceLoginStart) {
  const serverExpiry = Date.parse(pairing.expires_at);
  return Number.isFinite(serverExpiry)
    ? serverExpiry
    : Date.now() + Math.max(1, pairing.expires_in) * 1000;
}

function readPendingPairing(serverUrl: string): DeviceLoginStart | null {
  try {
    const value = localStorage.getItem(pairingKey(serverUrl));
    if (!value) return null;
    const pairing = JSON.parse(value) as DeviceLoginStart;
    if (!pairing.device_code || pairingExpiresAt(pairing) <= Date.now()) {
      localStorage.removeItem(pairingKey(serverUrl));
      return null;
    }
    return pairing;
  } catch {
    localStorage.removeItem(pairingKey(serverUrl));
    return null;
  }
}

export function clearPendingDeviceLogin(serverUrl: string) {
  localStorage.removeItem(pairingKey(serverUrl));
}

export async function getOrStartDeviceLogin(
  serverUrl: string,
  deviceName = "LG webOS TV"
): Promise<DeviceLoginStart> {
  const cached = readPendingPairing(serverUrl);
  if (cached) return cached;

  const key = normalizeServerUrl(serverUrl);
  const existing = pendingStarts.get(key);
  if (existing) return existing;

  const start = startDeviceLogin(serverUrl, deviceName)
    .then((pairing) => {
      localStorage.setItem(pairingKey(serverUrl), JSON.stringify(pairing));
      return pairing;
    })
    .finally(() => pendingStarts.delete(key));
  pendingStarts.set(key, start);
  return start;
}

export async function pollDeviceLogin(
  serverUrl: string,
  deviceCode: string
): Promise<DeviceLoginPoll> {
  return jsonRequest<DeviceLoginPoll>(
    serverUrl,
    "/api/v2/auth/device/poll",
    {
      method: "POST",
      body: JSON.stringify({ device_code: deviceCode })
    }
  );
}

export function sessionFromApprovedDeviceLogin(
  serverUrl: string,
  result: DeviceLoginPoll
): Session {
  if (result.status !== "approved" || !result.access_token) {
    throw new Error("Device login result is not approved.");
  }

  const userId =
    result.user?.id ??
    result.user?.Id ??
    result.profile_id ??
    "";

  const username =
    result.user?.username ??
    result.user?.name ??
    result.user?.Name ??
    "Silo user";

  return {
    serverUrl: normalizeServerUrl(serverUrl),
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    profileId: result.profile_id,
    profileToken: result.profile_token,
    userId,
    username
  };
}
