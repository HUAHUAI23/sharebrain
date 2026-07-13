import { m } from "@sharebrain/i18n";
import { NotionEmpty, NotionIcon, NotionList, NotionListRow, NotionText } from "@sharebrain/ui/components/notion";
import { useQuery } from "@tanstack/react-query";
import { BookOpenText, ChevronDown, ChevronLeft, ChevronRight, NotebookText, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { apiRequest, queryKeys } from "../../lib/api-client";
import { AccountMenu } from "../account/account-menu";
import type { ModulesResponse, WorkspaceView } from "../workspace/workspace-types";
import { CollectionModule } from "./collection-module";
import { TimelineModule } from "./timeline-module";

import type { Project } from "@sharebrain/contracts";

type ProjectViewProps = {
  projectId: string;
  activeModuleId?: string;
  onNavigate: (view: WorkspaceView) => void;
};

export function ProjectView({ projectId, activeModuleId, onNavigate }: ProjectViewProps) {
  const [customModulesOpen, setCustomModulesOpen] = useState(true);
  const activeModuleRef = useRef<HTMLButtonElement>(null);
  const modulesQuery = useQuery({
    queryKey: queryKeys.modules(projectId),
    queryFn: () => apiRequest<ModulesResponse>(`/api/projects/${projectId}/modules`),
  });
  const projectQuery = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => apiRequest<Project>(`/api/projects/${projectId}`),
  });
  const modules = modulesQuery.data?.items ?? [];
  const fixedModules = useMemo(() => modules.filter((module) => module.isSystemFixed), [modules]);
  const customModules = useMemo(() => modules.filter((module) => !module.isSystemFixed), [modules]);
  const activeModule = useMemo(
    () => modules.find((module) => module.id === activeModuleId) ?? modules[0],
    [activeModuleId, modules],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      activeModuleRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeModule?.id, customModulesOpen]);

  return (
    <main className="project-shell">
      <aside className="project-sidebar">
        <NotionListRow
          asChild
          className="project-sidebar-header grid-cols-[16px_24px_minmax(0,1fr)] px-1.5 py-1.5"
        >
          <button type="button" onClick={() => onNavigate({ type: "home" })}>
            <ChevronLeft size={15} />
            <NotionIcon>{(projectQuery.data?.name ?? "S").slice(0, 1).toUpperCase()}</NotionIcon>
            <NotionText title={projectQuery.data?.name ?? "ShareBrain"} description={m.workspace_personal()} />
          </button>
        </NotionListRow>
        <div className="sidebar-search">
          <Search size={14} />
          <span>{m.module_project_search()}</span>
        </div>
        <NotionList asChild>
          <nav
            className="project-module-nav mt-0.5"
            aria-label={m.module_templates_title()}
          >
            {fixedModules.map((module) => (
              <NotionListRow
                asChild
                key={module.id}
                active={module.id === activeModule?.id}
                className="project-module-link grid-cols-[18px_minmax(0,1fr)] px-2 py-1.5 text-[color-mix(in_oklab,var(--foreground)_72%,var(--background))]"
              >
                <button
                  type="button"
                  ref={module.id === activeModule?.id ? activeModuleRef : null}
                  onClick={() => onNavigate({ type: "project", projectId, moduleId: module.id })}
                >
                  {module.kind === "timeline" ? <NotebookText size={15} /> : <BookOpenText size={15} />}
                  <NotionText
                    title={module.name}
                    titleClassName="max-[860px]:max-w-35 max-[860px]:text-xs"
                    description={module.kind === "timeline" ? m.module_timeline_label() : m.module_collection_label()}
                    descriptionClassName="max-[860px]:hidden"
                  />
                </button>
              </NotionListRow>
            ))}
            {customModules.length > 0 ? (
              <>
                <NotionListRow
                  asChild
                  className="project-module-group grid-cols-[18px_minmax(0,1fr)] px-2 py-1.5 text-[color-mix(in_oklab,var(--foreground)_72%,var(--background))]"
                >
                  <button type="button" onClick={() => setCustomModulesOpen((value) => !value)}>
                    {customModulesOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    <NotionText title={m.module_custom_group()} description={m.module_count({ count: customModules.length })} />
                  </button>
                </NotionListRow>
                {customModules.map((module) => (
                  <NotionListRow
                    asChild
                    key={module.id}
                    active={module.id === activeModule?.id}
                    className="project-module-link project-module-custom grid-cols-[18px_minmax(0,1fr)] px-5 py-1.5 text-[color-mix(in_oklab,var(--foreground)_72%,var(--background))]"
                  >
                    <button
                      type="button"
                      ref={module.id === activeModule?.id ? activeModuleRef : null}
                      data-collapsed={!customModulesOpen}
                      onClick={() => onNavigate({ type: "project", projectId, moduleId: module.id })}
                    >
                      {module.kind === "timeline" ? <NotebookText size={15} /> : <BookOpenText size={15} />}
                      <NotionText
                        title={module.name}
                        titleClassName="max-[860px]:max-w-35 max-[860px]:text-xs"
                        description={module.kind === "timeline" ? m.module_timeline_label() : m.module_collection_label()}
                        descriptionClassName="max-[860px]:hidden"
                      />
                    </button>
                  </NotionListRow>
                ))}
              </>
            ) : null}
          </nav>
        </NotionList>
      </aside>
      <section className="project-content">
        <div className="project-accountbar"><AccountMenu /></div>
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
