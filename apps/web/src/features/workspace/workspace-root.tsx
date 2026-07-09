import { m } from "@sharebrain/i18n";
import { NotionEmpty } from "@sharebrain/ui/components/notion";
import { useQuery } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { ApiClientError, apiRequest, queryKeys } from "../../lib/api-client";
import { AuthView } from "../auth/auth-view";
import type { MeResponse } from "./workspace-types";

export function WorkspaceRoot() {
  const me = useQuery({
    queryKey: queryKeys.me,
    queryFn: () => apiRequest<MeResponse>("/api/me"),
    retry(failureCount, error) {
      if (error instanceof ApiClientError && error.code === "UNAUTHENTICATED") {
        return false;
      }

      return failureCount < 1;
    },
  });

  if (me.isLoading) {
    return (
      <main className="min-h-screen bg-background">
        <NotionEmpty className="p-20">{m.common_loading_workspace()}</NotionEmpty>
      </main>
    );
  }

  if (me.error instanceof ApiClientError && me.error.code === "UNAUTHENTICATED") {
    return <AuthView />;
  }

  if (me.error) {
    const message = me.error instanceof Error ? me.error.message : m.error_api_connect();

    return (
      <main className="min-h-screen bg-background p-20">
        <NotionEmpty className="grid gap-2 p-0">
          <strong className="text-base font-semibold text-foreground">{m.error_workspace_title()}</strong>
          <span className="max-w-xl text-[13px] leading-6 text-muted-foreground">{message}</span>
        </NotionEmpty>
      </main>
    );
  }

  return <Outlet />;
}
