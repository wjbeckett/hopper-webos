import { lazy, Suspense, type ComponentType, type JSX } from "react";
import { LoadingState } from "../components/LoadingState";

/**
 * A screen loaded the first time it opens (#208), so a launch parses only what Home needs. The
 * loading spinner shows while its code loads, and `preload` fetches it ahead of time. A failed load
 * (a dropped read from storage) is tried once more before it gives up.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyScreen<M extends Record<string, any>, K extends keyof M>(load: () => Promise<M>, name: K) {
  let pending: Promise<M> | null = null;
  const preload = () => {
    pending ??= load().catch(() => load()).catch(error => { pending = null; throw error; });
    return pending;
  };
  type Props = M[K] extends ComponentType<infer P> ? P : never;
  const Lazy = lazy(() => preload().then(module => ({ default: module[name] as ComponentType<Props> })));
  function Screen(props: Props) {
    return <Suspense fallback={<LoadingState />}><Lazy {...(props as Props & JSX.IntrinsicAttributes)} /></Suspense>;
  }
  Screen.preload = preload;
  return Screen;
}
