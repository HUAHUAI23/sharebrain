import { RouterProvider } from "@tanstack/react-router";

import { ErrorBoundary } from "./error-boundary";
import { AppProviders } from "./providers";
import { router } from "./router";

export function App() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </ErrorBoundary>
  );
}
