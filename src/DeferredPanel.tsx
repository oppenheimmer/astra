import { Component, Suspense, type ReactNode } from "react";

/** Optional panels can fail to download without taking the observing desk with them. */
export default class DeferredPanel extends Component<
  { label: string; children: ReactNode; hidden?: boolean }, { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    const { label, children, hidden } = this.props;
    return (
      <div hidden={hidden}>
        {this.state.failed ? (
          <p className="small-note" role="status">
            {label} unavailable. <button onClick={() => window.location.reload()}>RELOAD PAGE ↗</button>
          </p>
        ) : (
          <Suspense fallback={<p className="small-note" role="status">Loading {label.toLowerCase()}…</p>}>
            {children}
          </Suspense>
        )}
      </div>
    );
  }
}
