import { WorkspaceRoot } from "../features/workspace/workspace-root";
import { ErrorBoundary } from "./error-boundary";
import { AppProviders } from "./providers";

export function App() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <WorkspaceRoot />
      </AppProviders>
    </ErrorBoundary>
  );
}
