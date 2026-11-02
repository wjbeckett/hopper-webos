import { useEffect, useState } from "react";
import { getEffectiveSettings } from "../api/settings";
import type { Session, SiloItem } from "../types";

export type EpisodeSpoilerPreferences = { hideImages: boolean; hideOverviews: boolean };

export function useEpisodeSpoilerPreferences(session: Session): EpisodeSpoilerPreferences {
  const [preferences, setPreferences] = useState<EpisodeSpoilerPreferences>({ hideImages: false, hideOverviews: false });
  useEffect(() => {
    let alive = true;
    getEffectiveSettings(session, ["catalog.hide_unwatched_episode_images", "catalog.hide_unwatched_episode_overviews"])
      .then(values => {
        if (!alive) return;
        setPreferences({
          hideImages: values.get("catalog.hide_unwatched_episode_images")?.value === true,
          hideOverviews: values.get("catalog.hide_unwatched_episode_overviews")?.value === true
        });
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [session.profileId, session.serverUrl]);
  return preferences;
}

export function isUnwatchedEpisode(item: SiloItem): boolean {
  if (item.UserData?.Played === true) return false;
  return (item.UserData?.PlaybackPositionTicks ?? 0) <= 0;
}

export function hidesEpisodeOverview(item: SiloItem, preferences: EpisodeSpoilerPreferences): boolean {
  return item.Type === "Episode" && preferences.hideOverviews && isUnwatchedEpisode(item);
}

export function hidesEpisodeImage(item: SiloItem, preferences: EpisodeSpoilerPreferences, isEpisodeStill?: boolean): boolean {
  return item.Type === "Episode" && preferences.hideImages && isUnwatchedEpisode(item) && isEpisodeStill !== false;
}
