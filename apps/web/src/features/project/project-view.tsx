import { m } from "@sharebrain/i18n";
import { NotionEmpty, NotionIcon, NotionList, NotionListRow, NotionText } from "@sharebrain/ui/components/notion";
import { useQuery } from "@tanstack/react-query";
import { BookOpenText, ChevronDown, ChevronLeft, ChevronRight, NotebookText, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { apiRequest, queryKeys } from "../../lib/api-client";
import type { ModulesResponse, WorkspaceView } from "../workspace/workspace-types";
import { CollectionModule } from "./collection-module";
import { TimelineModule } from "./timeline-module";

type ProjectViewProps = {
  projectId: string;
  activeModuleId?: string;
  onNavigate: (view: WorkspaceView) => void;
};

export function ProjectView({ projectId, activeModuleId, onNavigate }: ProjectViewProps) {
  const [customModulesOpen, setCustomModulesOpen] = useState(true);
  const modulesQuery = useQuery({
    queryKey: queryKeys.modules(projectId),
    queryFn: () => apiRequest<ModulesResponse>(`/api/projects/${projectId}/modules`),
  });
  const modules = modulesQuery.data?.items ?? [];
  const fixedModules = useMemo(() => modules.filter((module) => module.isSystemFixed), [modules]);
  const customModules = useMemo(() => modules.filter((module) => !module.isSystemFixed), [modules]);
  const activeModule = useMemo(
    () => modules.find((module) => module.id === activeModuleId) ?? modules[0],
    [activeModuleId, modules],
  );

  return (
    <main className="project-shell">
      <aside className="project-sidebar">
        <NotionListRow asChild className="grid-cols-[16px_24px_minmax(0,1fr)] px-1.5 py-1.5">
          <button type="button" onClick={() => onNavigate({ type: "home" })}>
            <ChevronLeft size={15} />
            <NotionIcon>S</NotionIcon>
            <NotionText title="ShareBrain" description={m.workspace_personal()} />
          </button>
        </NotionListRow>
        <div className="sidebar-search">
          <Search size={14} />
          <span>{m.module_project_search()}</span>
        </div>
        <NotionList asChild>
          <nav
            className="mt-0.5 max-[860px]:grid-flow-col max-[860px]:auto-cols-[minmax(148px,1fr)] max-[860px]:overflow-x-auto"
            aria-label={m.module_templates_title()}
          >
            {fixedModules.map((module) => (
              <NotionListRow
                asChild
                key={module.id}
                active={module.id === activeModule?.id}
                className="grid-cols-[18px_minmax(0,1fr)] px-2 py-1.5 text-[color-mix(in_oklab,var(--foreground)_72%,var(--background))]"
              >
                <button type="button" onClick={() => onNavigate({ type: "project", projectId, moduleId: module.id })}>
                  {module.kind === "timeline" ? <NotebookText size={15} /> : <BookOpenText size={15} />}
                  <NotionText title={module.name} description={module.kind === "timeline" ? m.module_timeline_label() : m.module_collection_label()} />
                </button>
              </NotionListRow>
            ))}
            {customModules.length > 0 ? (
              <>
                <NotionListRow
                  asChild
                  className="grid-cols-[18px_minmax(0,1fr)] px-2 py-1.5 text-[color-mix(in_oklab,var(--foreground)_72%,var(--background))]"
                >
                  <button type="button" onClick={() => setCustomModulesOpen((value) => !value)}>
                    {customModulesOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    <NotionText title={m.module_custom_group()} description={m.module_count({ count: customModules.length })} />
                  </button>
                </NotionListRow>
                {customModulesOpen
                  ? customModules.map((module) => (
                      <NotionListRow
                        asChild
                        key={module.id}
                        active={module.id === activeModule?.id}
                        className="grid-cols-[18px_minmax(0,1fr)] px-5 py-1.5 text-[color-mix(in_oklab,var(--foreground)_72%,var(--background))]"
                      >
                        <button type="button" onClick={() => onNavigate({ type: "project", projectId, moduleId: module.id })}>
                          {module.kind === "timeline" ? <NotebookText size={15} /> : <BookOpenText size={15} />}
                          <NotionText title={module.name} description={module.kind === "timeline" ? m.module_timeline_label() : m.module_collection_label()} />
                        </button>
                      </NotionListRow>
                    ))
                  : null}
              </>
            ) : null}
          </nav>
        </NotionList>
      </aside>
      <section className="project-content">
        {activeModule ? (
          activeModule.kind === "timeline" ? (
            <TimelineModule projectId={projectId} moduleId={activeModule.id} module={activeModule} onNavigate={onNavigate} />
          ) : (
            <CollectionModule projectId={projectId} moduleId={activeModule.id} module={activeModule} onNavigate={onNavigate} />
          )
        ) : (
          <NotionEmpty className="p-20">{m.common_empty_module()}</NotionEmpty>
        )}
      </section>
    </main>
  );
}
