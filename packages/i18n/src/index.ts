import { z } from "zod";

export const localeSchema = z.enum(["zh-CN", "en-US"]);
export type Locale = z.infer<typeof localeSchema>;

export const defaultLocale: Locale = "zh-CN";
export const supportedLocales = localeSchema.options;

type MessageKey =
  | "app.name"
  | "app.subtitle"
  | "nav.projects"
  | "nav.search"
  | "nav.timeline"
  | "nav.settings"
  | "editor.placeholder"
  | "status.frameworkOnly";

const messages: Record<Locale, Record<MessageKey, string>> = {
  "zh-CN": {
    "app.name": "ShareBrain",
    "app.subtitle": "私有化项目周期上下文管理平台",
    "nav.projects": "项目",
    "nav.search": "搜索",
    "nav.timeline": "时间线",
    "nav.settings": "设置",
    "editor.placeholder": "选择项目文档后开始协作编辑",
    "status.frameworkOnly": "当前阶段仅搭建开发框架，业务功能暂未实现。",
  },
  "en-US": {
    "app.name": "ShareBrain",
    "app.subtitle": "Private project lifecycle context platform",
    "nav.projects": "Projects",
    "nav.search": "Search",
    "nav.timeline": "Timeline",
    "nav.settings": "Settings",
    "editor.placeholder": "Select a project document to start collaborative editing",
    "status.frameworkOnly": "This stage only establishes the development framework.",
  },
};

export function resolveLocale(value: string | undefined): Locale {
  const result = localeSchema.safeParse(value);
  return result.success ? result.data : defaultLocale;
}

export function t(locale: Locale, key: MessageKey) {
  return messages[locale][key];
}
