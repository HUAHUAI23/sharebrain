import { m } from "@sharebrain/i18n";
import { NotionEmpty } from "@sharebrain/ui/components/notion";
import {
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
} from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiRequest, queryKeys } from "../lib/api-client";
import { HomeView } from "../features/home/home-view";
import { ModuleTemplatesView } from "../features/modules/module-templates-view";
import { ProjectView } from "../features/project/project-view";
import { StorageView } from "../features/storage/storage-view";
import { WorkspaceRoot } from "../features/workspace/workspace-root";
import type { DocumentResponse, WorkspaceView } from "../features/workspace/workspace-types";

const EditorShell = lazy(() =>
  import("../features/editor/editor-shell").then((module) => ({
    default: module.EditorShell,
  })),
);

const rootRoute = createRootRoute({
  component: WorkspaceRoot,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomeRouteComponent,
});

const moduleTemplatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings/new-project",
  component: ModuleTemplatesRouteComponent,
});

const moduleTemplateDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings/new-project/modules/$templateId",
  component: ModuleTemplateDetailRouteComponent,
});

const storageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings/storage",
  component: StorageView,
});

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "projects/$projectId",
  component: ProjectRouteComponent,
});

const projectModuleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "projects/$projectId/modules/$moduleId",
  component: ProjectModuleRouteComponent,
});

const documentLookupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "documents/$documentId",
  component: DocumentLookupRouteComponent,
});

const moduleDocumentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "projects/$projectId/modules/$moduleId/documents/$documentId",
  component: ModuleDocumentRouteComponent,
});

const recordDocumentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "projects/$projectId/modules/$moduleId/records/$recordId/documents/$documentId",
  component: RecordDocumentRouteComponent,
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  moduleTemplatesRoute,
  moduleTemplateDetailRoute,
  storageRoute,
  projectRoute,
  projectModuleRoute,
  documentLookupRoute,
  moduleDocumentRoute,
  recordDocumentRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function useWorkspaceNavigate() {
  const navigate = useNavigate();

  return useCallback(
    (view: WorkspaceView) => {
      if (view.type === "home") {
        void navigate({ to: "/" });
        return;
      }

      if (view.type === "new-project-settings") {
        void navigate({ to: "/settings/new-project" });
        return;
      }

      if (view.type === "storage-settings") {
        void navigate({ to: "/settings/storage" });
        return;
      }

      if (view.type === "project") {
        if (view.moduleId) {
          void navigate({
            to: "/projects/$projectId/modules/$moduleId",
            params: { projectId: view.projectId, moduleId: view.moduleId },
          });
          return;
        }

        void navigate({
          to: "/projects/$projectId",
          params: { projectId: view.projectId },
        });
        return;
      }

      if (view.type === "document-lookup") {
        void navigate({
          to: "/documents/$documentId",
          params: { documentId: view.documentId },
        });
        return;
      }

      if (view.type === "document") {
        if (view.recordId) {
          void navigate({
            to: "/projects/$projectId/modules/$moduleId/records/$recordId/documents/$documentId",
            params: {
              documentId: view.documentId,
              moduleId: view.moduleId,
              projectId: view.projectId,
              recordId: view.recordId,
            },
          });
          return;
        }

        void navigate({
          to: "/projects/$projectId/modules/$moduleId/documents/$documentId",
          params: {
            documentId: view.documentId,
            moduleId: view.moduleId,
            projectId: view.projectId,
          },
        });
      }
    },
    [navigate],
  );
}

function HomeRouteComponent() {
  const onNavigate = useWorkspaceNavigate();

  return <HomeView onNavigate={onNavigate} />;
}

function ModuleTemplatesRouteComponent() {
  return <ModuleTemplatesView />;
}

function ModuleTemplateDetailRouteComponent() {
  const { templateId } = moduleTemplateDetailRoute.useParams();
  return <ModuleTemplatesView selectedTemplateId={templateId} />;
}

function ProjectRouteComponent() {
  const onNavigate = useWorkspaceNavigate();
  const { projectId } = projectRoute.useParams();

  return <ProjectView projectId={projectId} onNavigate={onNavigate} />;
}

function ProjectModuleRouteComponent() {
  const onNavigate = useWorkspaceNavigate();
  const { moduleId, projectId } = projectModuleRoute.useParams();

  return <ProjectView projectId={projectId} activeModuleId={moduleId} onNavigate={onNavigate} />;
}

function ModuleDocumentRouteComponent() {
  const onNavigate = useWorkspaceNavigate();
  const { documentId, moduleId, projectId } = moduleDocumentRoute.useParams();

  return (
    <EditorRouteFrame>
      <EditorShell
        projectId={projectId}
        moduleId={moduleId}
        documentId={documentId}
        onNavigate={onNavigate}
      />
    </EditorRouteFrame>
  );
}

function RecordDocumentRouteComponent() {
  const onNavigate = useWorkspaceNavigate();
  const { documentId, moduleId, projectId, recordId } = recordDocumentRoute.useParams();

  return (
    <EditorRouteFrame>
      <EditorShell
        projectId={projectId}
        moduleId={moduleId}
        recordId={recordId}
        documentId={documentId}
        onNavigate={onNavigate}
      />
    </EditorRouteFrame>
  );
}

function DocumentLookupRouteComponent() {
  const navigate = useNavigate();
  const { documentId } = documentLookupRoute.useParams();
  const document = useQuery({
    queryKey: queryKeys.document(documentId),
    queryFn: () => apiRequest<DocumentResponse>(`/api/documents/${documentId}`),
    retry: false,
  });

  useEffect(() => {
    const item = document.data;

    if (!item) return;

    if (item.moduleRecordId) {
      void navigate({
        to: "/projects/$projectId/modules/$moduleId/records/$recordId/documents/$documentId",
        params: {
          documentId: item.id,
          moduleId: item.moduleId,
          projectId: item.projectId,
          recordId: item.moduleRecordId,
        },
        replace: true,
      });
      return;
    }

    void navigate({
      to: "/projects/$projectId/modules/$moduleId/documents/$documentId",
      params: {
        documentId: item.id,
        moduleId: item.moduleId,
        projectId: item.projectId,
      },
      replace: true,
    });
  }, [document.data, navigate]);

  if (document.error) {
    const message = document.error instanceof Error ? document.error.message : m.error_api_connect();

    return (
      <main className="min-h-screen bg-background p-20">
        <NotionEmpty className="grid gap-2 p-0">
          <strong className="text-base font-semibold text-foreground">{m.error_workspace_title()}</strong>
          <span className="max-w-xl text-[13px] leading-6 text-muted-foreground">{message}</span>
        </NotionEmpty>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <NotionEmpty className="p-20">{m.common_loading_document()}</NotionEmpty>
    </main>
  );
}

function EditorRouteFrame({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-background">
          <NotionEmpty className="p-20">{m.common_loading_document()}</NotionEmpty>
        </main>
      }
    >
      {children}
    </Suspense>
  );
}
