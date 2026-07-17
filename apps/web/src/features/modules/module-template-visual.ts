// 为初始模块提供跨导航与详情一致的语义图标和克制色彩编码。
import {
  Files,
  LibraryBig,
  ListTree,
  NotebookPen,
  PanelsTopLeft,
  type LucideIcon,
} from "lucide-react";

import type { ModuleTemplate } from "@sharebrain/contracts";

type ModuleTemplateVisual = {
  Icon: LucideIcon;
  tone: string;
};

export function getModuleTemplateVisual(
  template: Pick<ModuleTemplate, "key" | "kind">,
): ModuleTemplateVisual {
  if (template.key === "logs") {
    return {
      Icon: NotebookPen,
      tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }

  if (template.key === "project-background") {
    return {
      Icon: PanelsTopLeft,
      tone: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
    };
  }

  if (template.key === "knowledge-base") {
    return {
      Icon: LibraryBig,
      tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }

  return template.kind === "timeline"
    ? {
        Icon: ListTree,
        tone: "bg-teal-500/10 text-teal-700 dark:text-teal-300",
      }
    : {
        Icon: Files,
        tone: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
      };
}
