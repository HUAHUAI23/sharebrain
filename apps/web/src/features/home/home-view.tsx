import { Input } from "@sharebrain/ui/components/input";
import { m } from "@sharebrain/i18n";
import { NotionCreateRow } from "@sharebrain/ui/components/notion-create-row";
import {
  NotionEmpty,
  NotionIcon,
  NotionList,
  NotionListRow,
  NotionSectionHeading,
  NotionText,
} from "@sharebrain/ui/components/notion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, FileText, Search } from "lucide-react";
import { useState } from "react";

import { ApiClientError } from "../../lib/api-client";
import { apiRequest, queryKeys } from "../../lib/api-client";
import { AccountMenu } from "../account/account-menu";
import type { ProjectsResponse, RecentsResponse, SearchResponse, WorkspaceView } from "../workspace/workspace-types";

type HomeViewProps = {
  onNavigate: (view: WorkspaceView) => void;
};

export function HomeView({ onNavigate }: HomeViewProps) {
  const [projectName, setProjectName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const recents = useQuery({
    queryKey: queryKeys.recents,
    queryFn: () => apiRequest<RecentsResponse>("/api/me/recents"),
  });
  const projects = useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => apiRequest<ProjectsResponse>("/api/projects"),
  });
  const searchResults = useQuery({
    queryKey: queryKeys.search(search),
    queryFn: () => apiRequest<SearchResponse>(`/api/search?q=${encodeURIComponent(search)}`),
    enabled: search.trim().length > 0,
  });
  const createProject = useMutation({
    mutationFn: (name: string) =>
      apiRequest<{ id: string }>("/api/projects", {
        method: "POST",
        body: { name },
      }),
    async onSuccess(project) {
      setProjectName("");
      setCreateError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      await queryClient.invalidateQueries({ queryKey: queryKeys.recents });
      onNavigate({ type: "project", projectId: project.id });
    },
    onError(error) {
      setCreateError(error instanceof ApiClientError ? error.message : m.project_create_error());
    },
  });

  const recentItems = recents.data?.items ?? [];
  const projectItems = projects.data?.items ?? [];
  const visibleProjects = recentItems.length > 0 ? recentItems : projectItems;
  return (
    <main className="home-shell">
      <header className="home-topbar">
        <AccountMenu />
      </header>

      <section className="home-center">
        <div className="home-search">
          <Search size={18} />
          <Input
            className="h-9.5 border-0 bg-transparent p-0 shadow-none hover:bg-transparent focus-visible:border-transparent focus-visible:bg-transparent focus-visible:ring-0"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={m.home_search_aria()}
            placeholder={m.home_search_placeholder()}
          />
        </div>

        {search.trim().length > 0 && (
          <div className="search-popover">
            {(searchResults.data?.items ?? []).length > 0 ? (
              (searchResults.data?.items ?? []).map((item) => (
                <button
                  type="button"
                  className="grid min-h-8 grid-cols-[18px_minmax(0,1fr)] items-start gap-2 rounded-md border-0 bg-transparent p-2 text-left hover:bg-accent"
                  key={item.id}
                  onClick={() => {
                    if (item.documentId) {
                      onNavigate({ type: "document-lookup", documentId: item.documentId });
                    } else if (item.projectId) {
                      onNavigate({ type: "project", projectId: item.projectId });
                    }
                  }}
                >
                  <FileText size={15} />
                  <NotionText title={item.title} description={item.snippet || item.entityType} />
                </button>
              ))
            ) : (
              <NotionEmpty>{m.home_no_search_results()}</NotionEmpty>
            )}
          </div>
        )}

        <section className="home-section">
          <NotionSectionHeading>
            <Clock3 size={15} />
            <h2>{m.home_recent_projects()}</h2>
          </NotionSectionHeading>
          <NotionList>
            {visibleProjects.length > 0 ? (
              visibleProjects.map((project) => (
                <NotionListRow
                  asChild
                  className="grid-cols-[28px_minmax(0,1fr)] px-2 py-1.5"
                  key={project.id}
                >
                  <button type="button" onClick={() => onNavigate({ type: "project", projectId: project.id })}>
                    <NotionIcon>{project.name.slice(0, 1).toUpperCase()}</NotionIcon>
                    <NotionText title={project.name} description={project.description ?? m.home_default_project_description()} />
                  </button>
                </NotionListRow>
              ))
            ) : (
              <NotionEmpty>{m.home_no_projects()}</NotionEmpty>
            )}
          </NotionList>
        </section>

        <NotionCreateRow
          value={projectName}
          onValueChange={(value) => {
            setProjectName(value);
            setCreateError(null);
          }}
          onCreate={() => createProject.mutate(projectName.trim() || m.project_untitled())}
          placeholder={m.project_create_placeholder()}
          ariaLabel={m.project_create_aria()}
          isPending={createProject.isPending}
          error={createError}
        />
      </section>
    </main>
  );
}
