import { useEffect, useState } from "react";
import { getMetadataAiOnView, type MetadataAiOnView } from "../api/silo";
import type { Session } from "../types";

/** The metadata-AI capability per server and profile, read once per app run. */
const metadataAiOnView = new Map<string, Promise<MetadataAiOnView>>();

export function useMetadataAiOnView(session: Session) {
  const key = `${session.serverUrl}|${session.profileId ?? ""}`;
  const [onView, setOnView] = useState<MetadataAiOnView>("off");
  useEffect(() => {
    let alive = true;
    let pending = metadataAiOnView.get(key);
    if (!pending) {
      pending = getMetadataAiOnView(session).catch(() => "off" as const);
      metadataAiOnView.set(key, pending);
    }
    void pending.then(value => { if (alive) setOnView(value); });
    return () => { alive = false; };
  }, [key]);
  return onView;
}
