import { t, defaultLocale } from "@sharebrain/i18n";
import { Button } from "@sharebrain/ui/components/button";
import { Input } from "@sharebrain/ui/components/input";
import { Surface } from "@sharebrain/ui/components/surface";
import {
  BookOpenText,
  ChevronDown,
  Clock3,
  FileText,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";

import { EditorShell } from "../features/editor/editor-shell";
import { useWorkspaceStore } from "../stores/workspace-store";
import { AppProviders } from "./providers";

const navItems = [
  { key: "documents" as const, label: t(defaultLocale, "nav.projects"), icon: FileText },
  { key: "search" as const, label: t(defaultLocale, "nav.search"), icon: Search },
  { key: "timeline" as const, label: t(defaultLocale, "nav.timeline"), icon: Clock3 },
];

const documentItems = [
  "项目概览",
  "交付记录",
  "故障复盘",
  "会议纪要",
  "交接文档",
];

function Workspace() {
  const { activePanel, setActivePanel, sidebarCollapsed, toggleSidebar } = useWorkspaceStore();

  return (
    <main className="app-layout">
      <aside className={sidebarCollapsed ? "sidebar sidebar-collapsed" : "sidebar"}>
        <div className="sidebar-header">
          <Button size="icon" variant="ghost" aria-label="切换侧边栏" onClick={toggleSidebar}>
            <PanelLeft size={16} />
          </Button>
          {!sidebarCollapsed && (
            <button className="workspace-switcher" type="button">
              <span className="workspace-icon">S</span>
              <strong>{t(defaultLocale, "app.name")}</strong>
              <ChevronDown size={14} />
            </button>
          )}
        </div>
        {!sidebarCollapsed && <Input aria-label="全局搜索" placeholder="搜索项目、文档、时间线" />}
        <nav className="sidebar-nav" aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.key}
                variant={activePanel === item.key ? "secondary" : "ghost"}
                className="nav-button"
                onClick={() => setActivePanel(item.key)}
              >
                <Icon size={16} />
                {!sidebarCollapsed && item.label}
              </Button>
            );
          })}
        </nav>
        {!sidebarCollapsed && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">
              <span>Private Project</span>
              <Button size="icon" variant="ghost" aria-label="新建文档">
                <Plus size={14} />
              </Button>
            </div>
            <div className="page-list">
              {documentItems.map((item) => (
                <button className="page-row" key={item} type="button">
                  <FileText size={15} />
                  <span>{item}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p>{t(defaultLocale, "app.subtitle")}</p>
            <h1>{t(defaultLocale, "app.name")}</h1>
          </div>
          <div className="header-actions">
            <Button variant="ghost" size="icon" aria-label="AI">
              <Sparkles size={16} />
            </Button>
            <Button variant="ghost" size="icon" aria-label={t(defaultLocale, "nav.settings")}>
              <Settings size={16} />
            </Button>
            <Button variant="ghost" size="icon" aria-label="更多">
              <MoreHorizontal size={16} />
            </Button>
          </div>
        </header>

        <div className="workspace-grid">
          <Surface className="project-panel">
            <div className="page-icon">
              <BookOpenText size={28} />
            </div>
            <p className="panel-eyebrow">Workspace</p>
            <h2>项目上下文</h2>
            <p>{t(defaultLocale, "status.frameworkOnly")}</p>
            <div className="panel-list">
              <button type="button">
                <FileText size={15} />
                文档树
              </button>
              <button type="button">
                <Search size={15} />
                全库搜索
              </button>
              <button type="button">
                <Clock3 size={15} />
                时间线
              </button>
              <button type="button">
                <Sparkles size={15} />
                AI Context Pack
              </button>
            </div>
          </Surface>
          <EditorShell />
        </div>
      </section>
    </main>
  );
}

export function App() {
  return (
    <AppProviders>
      <Workspace />
    </AppProviders>
  );
}
