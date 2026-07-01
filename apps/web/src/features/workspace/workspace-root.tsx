import { m } from "@sharebrain/i18n";
import { NotionEmpty } from "@sharebrain/ui/components/notion";
import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiClientError, apiRequest, queryKeys } from "../../lib/api-client";
import { AuthView } from "../auth/auth-view";
import { HomeView } from "../home/home-view";
import { ModuleTemplatesView } from "../modules/module-templates-view";
import { ProjectView } from "../project/project-view";
import type { MeResponse, WorkspaceView } from "./workspace-types";

const EditorShell = lazy(() =>
  import("../editor/editor-shell").then((module) => ({ default: module.EditorShell })),
);

export function WorkspaceRoot() {
  const [view, setView] = useState<WorkspaceView>({ type: "home" });
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

  if (view.type === "project") {
    return (
      <ProjectView
        projectId={view.projectId}
        {...(view.moduleId ? { activeModuleId: view.moduleId } : {})}
        onNavigate={setView}
      />
    );
  }

  if (view.type === "module-templates") {
    return <ModuleTemplatesView onNavigate={setView} />;
  }

  if (view.type === "document") {
    return (
      <Suspense
        fallback={
          <main className="min-h-screen bg-background">
            <NotionEmpty className="p-20">{m.common_loading_document()}</NotionEmpty>
          </main>
        }
      >
        <EditorShell
          projectId={view.projectId}
          moduleId={view.moduleId}
          documentId={view.documentId}
          {...(view.recordId ? { recordId: view.recordId } : {})}
          onNavigate={setView}
        />
      </Suspense>
    );
  }

  return <HomeView onNavigate={setView} />;
}
