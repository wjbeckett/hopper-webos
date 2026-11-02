export type DolbyVisionProfileLevel = { profile: number; max_level: number; bl_compatibility_ids: number[] };

const PROBES: { profile: number; level: number; blCompatibilityIds: number[]; types: string[] }[] = [
  { profile: 5, level: 6, blCompatibilityIds: [0], types: ['video/mp4; codecs="dvh1.05.06"', 'video/mp4; codecs="dvhe.05.06"'] },
  { profile: 8, level: 6, blCompatibilityIds: [1, 2, 4], types: ['video/mp4; codecs="dvh1.08.06"', 'video/mp4; codecs="dvhe.08.06"'] }
];

let cached: DolbyVisionProfileLevel[] | null = null;

function engineAccepts(type: string): boolean {
  try {
    if (typeof MediaSource !== "undefined" && typeof MediaSource.isTypeSupported === "function" && MediaSource.isTypeSupported(type)) return true;
  } catch { /* fall through */ }
  try {
    const probe = document.createElement("video");
    return probe.canPlayType(type) !== "";
  } catch {
    return false;
  }
}

/** Profiles the TV's media engine confirms. Profile 7 is never advertised: LG webOS plays only the HDR10 base layer of dual-layer sources. */
export function detectedDolbyVisionProfiles(): DolbyVisionProfileLevel[] {
  if (!cached) cached = PROBES.filter(entry => entry.types.some(engineAccepts)).map(entry => ({ profile: entry.profile, max_level: entry.level, bl_compatibility_ids: entry.blCompatibilityIds }));
  return cached;
}

/** Mirrors Android's DolbyVisionPolicy.advertisableProfiles: with Dolby Vision off only profile 5 (which has no fallback layer) remains. */
export function advertisableDolbyVisionProfiles(enabled: boolean): DolbyVisionProfileLevel[] {
  return detectedDolbyVisionProfiles().filter(entry => enabled || entry.profile === 5);
}
