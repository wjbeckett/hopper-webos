type PalmSystemBack = { platformBack?: () => void };

declare global {
  interface Window { PalmSystem?: PalmSystemBack }
}

/**
 * Hands Back over to the TV, as LG requires on an app's entry page: webOS 6 and later
 * show the system's "exit app?" popup, older versions open the Home launcher. This is
 * what LG's `webOS.platformBack()` calls. Returns false in a desktop browser, where
 * there is nothing to hand over to.
 */
export function platformBack(): boolean {
  const palm = window.PalmSystem;
  if (!palm || typeof palm.platformBack !== "function") return false;
  palm.platformBack();
  return true;
}
