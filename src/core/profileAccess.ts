// Port of shared ProfileAccessLimits: a profile's rating ceiling and library
// allowlist. Child only fills kid-safe defaults for limits not yet touched in
// this form; turning Child off clears them.

// Android's TV form shows no quality/subtitle controls, so only ratings are ported.
export const TV_CONTENT_RATINGS = ["G", "PG", "PG-13", "R", "NC-17"];
export const DEFAULT_CHILD_CONTENT_RATING = "PG";
export const CHOOSE_A_LIBRARY_MESSAGE = "Select at least one library for this profile.";

export type AccessLimits = {
  isChild: boolean;
  maxContentRating: string | null;
  libraryRestrictionsEnabled: boolean;
  allowedLibraryIds: number[];
  /** Form-only flags: a choice made here, which Child then leaves alone. */
  ratingTouched: boolean;
  librariesTouched: boolean;
};

export const EMPTY_ACCESS: AccessLimits = {
  isChild: false,
  maxContentRating: null,
  libraryRestrictionsEnabled: false,
  allowedLibraryIds: [],
  ratingTouched: false,
  librariesTouched: false
};

export function withChild(access: AccessLimits, child: boolean): AccessLimits {
  if (!child) return EMPTY_ACCESS;
  const fillRating = !access.ratingTouched && access.maxContentRating === null;
  const fillLibraries = !access.librariesTouched && !access.libraryRestrictionsEnabled;
  return {
    ...access,
    isChild: true,
    maxContentRating: fillRating ? DEFAULT_CHILD_CONTENT_RATING : access.maxContentRating,
    libraryRestrictionsEnabled: access.libraryRestrictionsEnabled || fillLibraries,
    allowedLibraryIds: fillLibraries ? [] : access.allowedLibraryIds
  };
}

export function withLibrary(access: AccessLimits, id: number, allowed: boolean): AccessLimits {
  const ids = access.allowedLibraryIds.filter(existing => existing !== id);
  return { ...access, allowedLibraryIds: allowed ? [...ids, id] : ids, librariesTouched: true };
}

function sameIds(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  const wanted = new Set(right);
  return left.every(id => wanted.has(id));
}

function allowlistChanged(limits: AccessLimits, loaded: AccessLimits): boolean {
  return limits.libraryRestrictionsEnabled !== loaded.libraryRestrictionsEnabled
    || (limits.libraryRestrictionsEnabled && !sameIds(limits.allowedLibraryIds, loaded.allowedLibraryIds));
}

/** Restricted with no (assignable) library chosen. On edit, an untouched allowlist is not checked. */
export function needsLibrary(limits: AccessLimits, loaded: AccessLimits | null, assignable: number[] | null): boolean {
  return limits.libraryRestrictionsEnabled
    && (loaded === null || allowlistChanged(limits, loaded))
    && !limits.allowedLibraryIds.some(id => assignable === null || assignable.includes(id));
}

/** POST body members for a new profile; create omits what it doesn't set. */
export function createAccessFields(limits: AccessLimits): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (limits.isChild) fields.is_child = true;
  if (limits.maxContentRating) fields.max_content_rating = limits.maxContentRating;
  if (limits.libraryRestrictionsEnabled) {
    fields.library_restrictions_enabled = true;
    fields.allowed_library_ids = [...limits.allowedLibraryIds].sort((a, b) => a - b).map(String);
  }
  return fields;
}

/**
 * PATCH body members for an edit. `is_child` always; rating and allowlist only
 * when changed from what was loaded (null clears the rating). A changed
 * allowlist keeps only assignable libraries.
 */
export function updateAccessFields(limits: AccessLimits, loaded: AccessLimits, assignable: number[] | null): Record<string, unknown> {
  const fields: Record<string, unknown> = { is_child: limits.isChild };
  if (limits.maxContentRating !== loaded.maxContentRating) fields.max_content_rating = limits.maxContentRating;
  if (limits.libraryRestrictionsEnabled !== loaded.libraryRestrictionsEnabled) {
    fields.library_restrictions_enabled = limits.libraryRestrictionsEnabled;
  }
  if (allowlistChanged(limits, loaded)) {
    fields.allowed_library_ids = limits.libraryRestrictionsEnabled
      ? limits.allowedLibraryIds.filter(id => assignable === null || assignable.includes(id)).sort((a, b) => a - b).map(String)
      : [];
  }
  return fields;
}

export function ratingCeilingCaption(ceiling: string | null): string {
  return ceiling === null ? "Can watch titles of any rating." : `Can watch titles rated ${ceiling} and below.`;
}

export function hasProfileNamed(names: { id: string; name: string }[], name: string, excludeId?: string): boolean {
  const wanted = name.trim().toLowerCase();
  return names.some(profile => profile.id !== excludeId && profile.name.trim().toLowerCase() === wanted);
}
