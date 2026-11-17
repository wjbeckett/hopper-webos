import type { Session } from "../types";
import { serverFetch } from "./connection";

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
  status: "pending" | "approved" | "denied" | "expired" | "consumed" | "canceled" | string;
  poll_after?: number;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    user?: { id?: string; username?: string };
  };
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
  const response = await serverFetch(serverUrl, `${normalizeServerUrl(serverUrl)}${path}`, {
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
  const accessToken = result.tokens?.access_token ?? result.access_token;
  const user = result.tokens?.user ?? result.user;
  if (result.status !== "approved" || !accessToken) {
    throw new Error("Device login result is not approved.");
  }

  const userId =
    user?.id ??
    result.user?.Id ??
    result.profile_id ??
    "";

  const username =
    user?.username ??
    result.user?.name ??
    result.user?.Name ??
    "Silo user";

  return {
    serverUrl: normalizeServerUrl(serverUrl),
    accessToken,
    refreshToken: result.tokens?.refresh_token ?? result.refresh_token,
    profileId: result.profile_id,
    profileToken: result.profile_token,
    userId,
    username
  };
}

/** `GET /auth/device/capability`, as far as the phone-profile handoff needs it (#156). */
export type DeviceLoginCapability = {
  state?: string;
  allowed?: boolean;
  remote_playback_handoff?: boolean;
  protocol_versions?: number[];
};

export type RemotePlaybackStart = DeviceLoginStart & { client_purpose?: string; temporary?: boolean };

export function getDeviceLoginCapability(serverUrl: string) {
  return jsonRequest<DeviceLoginCapability>(serverUrl, "/api/v2/auth/device/capability", { method: "GET" });
}

/**
 * A temporary device login for a phone's profile (spec section 8.2, Android TV
 * `startRemotePlaybackAt`). The phone approves it; nothing is saved.
 */
export function startRemotePlaybackLogin(serverUrl: string, deviceName: string) {
  return jsonRequest<RemotePlaybackStart>(serverUrl, "/api/v2/auth/device/start", {
    method: "POST",
    body: JSON.stringify({ device_name: deviceName, device_platform: "webOS", client_purpose: "remote_playback", temporary: true })
  });
}

/** Withdraws a device login this TV started. Best effort. */
export async function cancelDeviceLogin(serverUrl: string, deviceCode: string) {
  await jsonRequest<unknown>(serverUrl, "/api/v2/auth/device/cancel", { method: "POST", body: JSON.stringify({ device_code: deviceCode }) });
}

/** Ends a borrowed sign-in on the server (`POST /auth/logout` with its own tokens), once, no retry. */
export async function logoutTemporary(session: Session) {
  const response = await serverFetch(session.serverUrl, `${normalizeServerUrl(session.serverUrl)}/api/v2/auth/logout`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      ...(session.profileId ? { "X-Profile-Id": session.profileId } : {}),
      ...(session.profileToken ? { "X-Profile-Token": session.profileToken } : {})
    }
  });
  if (!response.ok && response.status !== 401) throw new Error(`/auth/logout: ${response.status}`);
}
