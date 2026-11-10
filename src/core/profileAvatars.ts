// Port of Android TvProfileAvatarPresets (silo-apple / web avatar contract):
//   preset:dicebear:<styleId>:<seed>

export type AvatarStyle = { id: string; label: string };
export type AvatarPreset = { styleId: string; seed: string; ref: string; previewUrl: string };

export const AVATAR_STYLES: AvatarStyle[] = [
  { id: "identicon", label: "Identicon" },
  { id: "initials", label: "Initials" },
  { id: "bottts-neutral", label: "Bottts" },
  { id: "fun-emoji", label: "Fun Emoji" },
  { id: "pixel-art-neutral", label: "Pixel Art" }
];

export const DEFAULT_AVATAR_STYLE = "fun-emoji";
const OPTION_COUNT = 18;

const ADJECTIVES = [
  "cosmic", "jelly", "starlight", "mango", "bubble", "neon", "marble",
  "comet", "snappy", "pepper", "glimmer", "ripple", "pocket", "candy",
  "ember", "mochi", "sprout", "twinkle", "whiz", "plasma", "mint",
  "velvet", "crunchy", "sunbeam", "toffee", "splash", "boomer", "lunar",
  "fizzy", "biscuit", "rocket", "cobalt"
];
const NOUNS = [
  "otter", "rocket", "fox", "cookie", "gecko", "bunny", "penguin",
  "puffin", "tiger", "panda", "saturn", "wizard", "skater", "nebula",
  "robot", "pirate", "meteor", "sprite", "pebble", "nova", "dragon",
  "donut", "parrot", "panther", "goblin", "muffin", "laser", "pickle",
  "falcon", "sunset", "toaster", "bandit"
];

const positiveMod = (value: number, modulus: number) => ((value % modulus) + modulus) % modulus;

export function presetRef(styleId: string, seed: string): string {
  return `preset:dicebear:${styleId}:${seed}`;
}

export function avatarImageUrl(styleId: string, seed: string, size = 256): string {
  return `https://api.dicebear.com/9.x/${encodeURIComponent(styleId)}/png?seed=${encodeURIComponent(seed)}&size=${size}`;
}

function makePreset(styleId: string, seed: string): AvatarPreset {
  return { styleId, seed, ref: presetRef(styleId, seed), previewUrl: avatarImageUrl(styleId, seed) };
}

/** Deterministic 18-avatar page for a style; `batch` advances on Shuffle. */
export function avatarBatch(styleId: string, batch = 0): AvatarPreset[] {
  const style = AVATAR_STYLES.some(candidate => candidate.id === styleId) ? styleId : DEFAULT_AVATAR_STYLE;
  const styleLen = style.length;
  return Array.from({ length: OPTION_COUNT }, (_, index) => {
    const adjective = ADJECTIVES[positiveMod(batch * 7 + index * 3 + styleLen, ADJECTIVES.length)];
    const noun = NOUNS[positiveMod(batch * 11 + index * 5 + styleLen * 2, NOUNS.length)];
    return makePreset(style, `${adjective}-${noun}`);
  });
}

export function parseAvatarRef(value?: string | null): AvatarPreset | null {
  const parts = (value ?? "").trim().split(":");
  if (parts.length < 4) return null;
  // Android splits with limit = 4, so a seed may itself contain ':'.
  const [scheme, provider, rawStyle, ...rest] = parts;
  const style = rawStyle.trim();
  const seed = rest.join(":").trim();
  if (scheme.toLowerCase() !== "preset" || provider.toLowerCase() !== "dicebear") return null;
  if (!style || !seed) return null;
  return makePreset(style, seed);
}

/** The avatar ref a save sends, matching Android's effectiveAvatarRef order. */
export function effectiveAvatarRef(args: {
  styleId: string;
  selectedSeed: string | null;
  batch: number;
  name: string;
  fallbackAvatar: string | null;
}): string | null {
  const { styleId, selectedSeed, batch, name, fallbackAvatar } = args;
  if (styleId === "initials") return presetRef("initials", name.trim() || "You");
  if (selectedSeed?.trim()) return presetRef(styleId, selectedSeed);
  if (fallbackAvatar && parseAvatarRef(fallbackAvatar)?.styleId === styleId) return fallbackAvatar;
  if (fallbackAvatar?.trim() && !parseAvatarRef(fallbackAvatar)) return fallbackAvatar;
  return avatarBatch(styleId, batch)[0]?.ref ?? null;
}
