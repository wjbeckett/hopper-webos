// Mirrors Android TV's TvMediaTypeFilters.visibleOnTv + MediaMode ebook taxonomy:
// TV hides ebook-like content (no reader on TV) but keeps audiobooks.
const ebookLikeTypes = new Set([
  "ebook", "ebooks", "book", "books", "comic", "comics", "manga", "reading",
]);

export function isTvHiddenMediaType(type?: string): boolean {
  return ebookLikeTypes.has((type ?? "").trim().toLowerCase());
}

export function isAudiobookMediaType(type?: string): boolean {
  return ["audiobook", "audiobooks"].includes((type ?? "").trim().toLowerCase());
}

export function hasTvHiddenMediaType(type?: string): boolean {
  return isTvHiddenMediaType(type);
}

export function filterTvVisibleTypes<T extends { Type?: string }>(items: T[]): T[] {
  return items.filter((item) => !isTvHiddenMediaType(item.Type));
}

// Mirrors shared LibraryMediaScope.matchesLibraryMediaScope: a mixed library's
// Movies/Series view keeps a row's filter on the section-browse page.
export function matchesLibraryMediaScope(type: string | undefined, scope: string | null | undefined): boolean {
  const normalized = (type ?? "").trim().toLowerCase();
  if (scope === "movie") return ["movie", "movies", "film"].includes(normalized);
  if (scope === "series") return ["series", "show", "shows", "tv", "episode"].includes(normalized);
  return true;
}
