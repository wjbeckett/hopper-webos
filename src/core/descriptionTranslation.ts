/**
 * Description translation (metadata AI), as Android TV's DescriptionTranslationController does it:
 * ask Silo for the translation (202), then read the item again on a backoff until the server
 * stops reporting a pending language. There is no job-status endpoint for this.
 */

/** Seconds between reads: Android's (and Apple's) opening backoff, held at 5 s, about 45 s in all. */
export const TRANSLATION_POLL_SECONDS = [1, 2, 3, 4, 5, 5, 5, 5, 5, 5, 5];

export type TranslationResult = "translated" | "failed" | "abandoned";

export async function runDescriptionTranslation(options: {
  /** Sends the request; resolves the job status from the 202. */
  request: () => Promise<string>;
  /** Reads the item again; resolves its pending language, or null once the translation has landed. */
  refetchPending: () => Promise<string | null | undefined>;
  /** False once the screen has moved on: the run stops without a result to show. */
  isCurrent: () => boolean;
  wait?: (ms: number) => Promise<void>;
}): Promise<TranslationResult> {
  const wait = options.wait ?? (ms => new Promise<void>(resolve => window.setTimeout(resolve, ms)));
  try {
    const status = await options.request();
    if (!options.isCurrent()) return "abandoned";
    // A 202 can hand back a job that failed in the last fifteen minutes without starting a new one.
    if (status === "failed" || status === "canceled") return "failed";
    for (const seconds of TRANSLATION_POLL_SECONDS) {
      await wait(seconds * 1000);
      if (!options.isCurrent()) return "abandoned";
      const pending = await options.refetchPending();
      if (!options.isCurrent()) return "abandoned";
      if (!pending) return "translated";
    }
    return "failed";
  } catch {
    return options.isCurrent() ? "failed" : "abandoned";
  }
}

const autoStarted = new Set<string>();

/** "auto" mode starts a translation once per title and language for as long as the app runs. */
export function claimAutoTranslation(contentId: string, language: string) {
  const key = `${contentId}|${language}`;
  if (autoStarted.has(key)) return false;
  autoStarted.add(key);
  return true;
}

/** Whether the server reports the overview itself as machine-translated (it can mark only a tagline). */
export function hasMachineTranslatedOverview(fields: string[] | undefined) {
  return Boolean(fields?.includes("overview"));
}
