import { getDeviceId } from "../platform/device";
import type { Session } from "../types";
import { requestV2 } from "./silo";

export type SettingOption = { label: string; value: string | number | boolean; deprecated?: boolean };
export type SettingSchema = {
  type: string;
  nullable?: boolean;
  minimum?: number;
  maximum?: number;
  values?: SettingOption[];
};
export type SettingDefinition = {
  key: string;
  label: string;
  description?: string;
  category?: string;
  default_value?: unknown;
  allowed_scopes?: Array<string | Record<string, unknown>>;
  value_schema: SettingSchema;
  unit?: string;
};
export type SettingsContract = {
  revision: number;
  definitions: SettingDefinition[];
  option_sets: Record<string, { options: Array<{ value: string }> }>;
};
export type SettingValue = { key: string; value: unknown; source?: string };

const deviceHeaders = () => ({ "X-Silo-Device-Id": getDeviceId(), "X-Silo-Client-Family": "tv" });

export function getSettingsContract(session: Session) {
  return requestV2<SettingsContract>(session, "/settings/contract");
}

export async function getEffectiveSettings(session: Session, keys: string[]): Promise<Map<string, SettingValue>> {
  const params = new URLSearchParams();
  keys.forEach(key => params.append("keys", key));
  const data = await requestV2<{ items?: SettingValue[] }>(session, `/settings/values/effective?${params}`, { headers: deviceHeaders() });
  return new Map((data.items ?? []).map(item => [item.key, item]));
}

export function isClientLocal(definition: SettingDefinition) {
  return (definition.allowed_scopes ?? []).includes("client_local");
}

function scopeQuery(session: Session, definition: SettingDefinition) {
  const scopes = (definition.allowed_scopes ?? []).filter((scope): scope is string => typeof scope === "string");
  const params = new URLSearchParams();
  if (scopes.includes("profile")) {
    params.set("scope", "profile");
    if (session.profileId) params.set("profile_id", session.profileId);
  } else {
    params.set("scope", "profile_device");
    if (session.profileId) params.set("profile_id", session.profileId);
    params.set("device_id", getDeviceId());
  }
  return params;
}

export function putSetting(session: Session, definition: SettingDefinition, value: unknown) {
  return requestV2<unknown>(session, `/settings/values/${encodeURIComponent(definition.key)}?${scopeQuery(session, definition)}`, {
    method: "PUT",
    headers: deviceHeaders(),
    body: JSON.stringify({ value })
  });
}

export function clearSetting(session: Session, definition: SettingDefinition) {
  return requestV2<unknown>(session, `/settings/values/${encodeURIComponent(definition.key)}?${scopeQuery(session, definition)}`, {
    method: "DELETE",
    headers: deviceHeaders()
  });
}

export type SubtitleAppearance = {
  fontSize: "small" | "medium" | "large" | "xlarge" | "xxlarge";
  fontFamily: string;
  fontColor: string;
  textOpacity: number;
  backgroundColor: string;
  backgroundStyle: "box" | "shadow" | "outline" | "none";
  backgroundOpacity: number;
  textOutline: boolean;
  textOutlineColor: string;
  position: "bottom" | "lower-third" | "top";
};

export const DEFAULT_SUBTITLE_APPEARANCE: SubtitleAppearance = {
  fontSize: "large", fontFamily: "sans-serif", fontColor: "#ffffff", textOpacity: 100,
  backgroundColor: "#000000", backgroundStyle: "shadow", backgroundOpacity: 75,
  textOutline: false, textOutlineColor: "#000000", position: "bottom"
};

export function putDeviceSubtitleAppearance(session: Session, appearance: SubtitleAppearance) {
  return requestV2<unknown>(session, "/settings/device/subtitle-appearance", {
    method: "PUT", headers: deviceHeaders(), body: JSON.stringify({ value: JSON.stringify(appearance) })
  });
}

export function putProfileSubtitleAppearance(session: Session, appearance: SubtitleAppearance) {
  const params = new URLSearchParams({ scope: "profile" });
  if (session.profileId) params.set("profile_id", session.profileId);
  return requestV2<unknown>(session, `/settings/values/playback.subtitle_appearance?${params}`, {
    method: "PUT", headers: deviceHeaders(), body: JSON.stringify({ value: appearance })
  });
}

export function clearDeviceSubtitleAppearance(session: Session) {
  return requestV2<unknown>(session, "/settings/device/subtitle-appearance", {
    method: "DELETE", headers: deviceHeaders()
  });
}

export type CardScope = "profile" | "profile_device" | "profile_client";

function cardScopeQuery(session: Session, scope: CardScope) {
  const params = new URLSearchParams({ scope });
  if (session.profileId) params.set("profile_id", session.profileId);
  if (scope === "profile_device") params.set("device_id", getDeviceId());
  return params;
}

export function putScopedSetting(session: Session, key: string, scope: CardScope, value: unknown) {
  return requestV2<unknown>(session, `/settings/values/${encodeURIComponent(key)}?${cardScopeQuery(session, scope)}`, {
    method: "PUT", headers: deviceHeaders(), body: JSON.stringify({ value })
  });
}

export function clearScopedSetting(session: Session, key: string, scope: CardScope) {
  return requestV2<unknown>(session, `/settings/values/${encodeURIComponent(key)}?${cardScopeQuery(session, scope)}`, {
    method: "DELETE", headers: deviceHeaders()
  });
}
