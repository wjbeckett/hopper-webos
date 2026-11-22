import { Component, createRef, lazy, Suspense, type ComponentType, type JSX, type ReactNode } from "react";
import { LoadingState } from "../components/LoadingState";

/**
 * Shown when a screen's code could not be loaded, even after the second try. "Try again" starts a
 * fresh load; Back still leaves as usual. Without it the failed load would take the whole app down.
 */
class ScreenLoadBoundary extends Component<{ onRetry: () => void; render: () => ReactNode }, { failed: boolean }> {
  state = { failed: false };
  private retryButton = createRef<HTMLButtonElement>();

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(_props: unknown, previous: { failed: boolean }) {
    if (this.state.failed && !previous.failed) this.retryButton.current?.focus();
  }

  private retry = () => {
    this.props.onRetry();
    this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.render();
    return (
      <div className="empty-state" role="alert">
        <h2>Couldn't open this screen</h2>
        <p>Check the connection and try again.</p>
        <button ref={this.retryButton} type="button" className="tv-button" data-tv-focusable="true" data-nav-primary="true" onClick={this.retry}>Try again</button>
      </div>
    );
  }
}

/**
 * A screen loaded the first time it opens (#208), so a launch parses only what Home needs. The
 * loading spinner shows while its code loads, and `preload` fetches it ahead of time. A failed load
 * (a dropped read from storage) is tried once more before it gives up; then the screen offers to
 * try again, with a fresh `lazy()`, because React keeps a lazy component's failed load for good.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyScreen<M extends Record<string, any>, K extends keyof M>(load: () => Promise<M>, name: K) {
  let pending: Promise<M> | null = null;
  const preload = () => {
    pending ??= load().catch(() => load()).catch(error => { pending = null; throw error; });
    return pending;
  };
  type Props = M[K] extends ComponentType<infer P> ? P : never;
  const makeLazy = () => lazy(() => preload().then(module => ({ default: module[name] as ComponentType<Props> })));
  let Lazy = makeLazy();
  const retry = () => { pending = null; Lazy = makeLazy(); };
  function Screen(props: Props) {
    return (
      <ScreenLoadBoundary onRetry={retry} render={() => <Suspense fallback={<LoadingState />}><Lazy {...(props as Props & JSX.IntrinsicAttributes)} /></Suspense>} />
    );
  }
  Screen.preload = preload;
  return Screen;
}
