import { Component, type ReactNode } from "react";

/** A crash in one page must not blank the whole app. Keyed by route in App, so navigating away recovers it. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="err" role="alert">
        <span>Halaman ini gagal ditampilkan: {this.state.err.message}</span>
        <button className="btn text" onClick={() => this.setState({ err: null })}>Coba lagi</button>
      </div>
    );
  }
}
