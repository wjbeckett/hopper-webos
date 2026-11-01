import type { Session } from "../types";
import { requestV2 } from "./silo";

export type DiagnosticsCapabilities = {
  state: "available" | "disabled" | "not_configured" | "unsupported" | string;
  allowed: boolean;
  status: string;
  retention_days: number;
  consent_notice_version: number;
  max_bundle_bytes: number;
  server_instance_id: string;
};

export function getDiagnosticsCapabilities(session: Session) {
  return requestV2<DiagnosticsCapabilities>(session, "/diagnostics/capabilities");
}

export async function isChildProfile(session: Session): Promise<boolean | null> {
  if (!session.profileId) return false;
  const data = await requestV2<{ items?: Array<{ id: string | number; is_child?: boolean }> }>(session, "/profiles");
  const profile = data.items?.find(item => String(item.id) === session.profileId);
  return profile ? Boolean(profile.is_child) : null;
}
