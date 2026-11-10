import type { Session } from "../types";
import { requestV2 } from "./silo";

export async function isChildProfile(session: Session): Promise<boolean | null> {
  if (!session.profileId) return false;
  const data = await requestV2<{ items?: Array<{ id: string | number; is_child?: boolean }> }>(session, "/profiles");
  const profile = data.items?.find(item => String(item.id) === session.profileId);
  return profile ? Boolean(profile.is_child) : null;
}
