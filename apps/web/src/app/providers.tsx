import { UIProvider } from "@sharebrain/ui/components/ui-provider";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import { queryClient } from "./query-client";

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <UIProvider>{children}</UIProvider>
    </QueryClientProvider>
  );
}
