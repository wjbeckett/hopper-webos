import { getEffectiveSettings } from "../api/settings";
import type { Session } from "../types";

let showTitleArt = true;

export function titleArtEnabled() {
  return showTitleArt;
}

export function setTitleArtEnabled(value: boolean) {
  showTitleArt = value;
}

export async function hydrateTitleArt(session: Session) {
  try {
    const effective = await getEffectiveSettings(session, ["ui.title_art"]);
    const entry = effective.get("ui.title_art");
    showTitleArt = typeof entry?.value === "boolean" ? entry.value : true;
  } catch {
    showTitleArt = true;
  }
}
