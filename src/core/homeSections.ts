import type { HomeRail, Session } from "../types";

export type HomeSectionLayout = { order: string[]; hidden: string[] };

function layoutKey(session: Session) {
  return `silo-webos-home-sections.${session.serverUrl}.${session.profileId ?? ""}`;
}

export function readHomeSectionLayout(session: Session): HomeSectionLayout {
  try {
    const parsed = JSON.parse(localStorage.getItem(layoutKey(session)) ?? "null") as Partial<HomeSectionLayout> | null;
    return {
      order: Array.isArray(parsed?.order) ? parsed.order.filter((id): id is string => typeof id === "string") : [],
      hidden: Array.isArray(parsed?.hidden) ? parsed.hidden.filter((id): id is string => typeof id === "string") : []
    };
  } catch {
    return { order: [], hidden: [] };
  }
}

export function writeHomeSectionLayout(session: Session, layout: HomeSectionLayout) {
  localStorage.setItem(layoutKey(session), JSON.stringify(layout));
}

export function arrangeHomeRails(rails: HomeRail[], layout: HomeSectionLayout, includingHidden = false): HomeRail[] {
  const rank = new Map(layout.order.map((id, index) => [id, index]));
  const arranged = rails
    .filter(rail => rail.items.length > 0)
    .map((rail, index) => ({ rail, index }))
    .sort((left, right) => {
      const leftRank = rank.get(left.rail.id);
      const rightRank = rank.get(right.rail.id);
      if (leftRank != null && rightRank != null) return leftRank - rightRank;
      if (leftRank != null) return -1;
      if (rightRank != null) return 1;
      return left.index - right.index;
    })
    .map(entry => entry.rail);
  return includingHidden ? arranged : arranged.filter(rail => !layout.hidden.includes(rail.id));
}

export function retainedOrder(ids: string[], remembered: string[]) {
  const known = Array.from(new Set(ids));
  return [...known, ...Array.from(new Set(remembered)).filter(id => !known.includes(id))];
}
