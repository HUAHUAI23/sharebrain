import { m } from "@sharebrain/i18n";
import { NotionEmpty } from "@sharebrain/ui/components/notion";
import { Component, type ErrorInfo, type ReactNode } from "react";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ShareBrain render failed", error, info);
  }

  override render() {
    if (this.state.error) {
      return (
        <main className="min-h-screen bg-background p-20">
          <NotionEmpty className="grid gap-2 p-0">
            <strong className="text-base font-semibold text-foreground">{m.error_render_title()}</strong>
            <span className="max-w-xl text-[13px] leading-6 text-muted-foreground">
              {this.state.error.message || m.error_render_details()}
            </span>
          </NotionEmpty>
        </main>
      );
    }

    return this.props.children;
  }
}
