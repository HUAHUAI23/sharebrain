import { z } from "zod";

export const localeSchema = z.enum(["zh-CN", "en-US"]);
export type Locale = z.infer<typeof localeSchema>;

export const defaultLocale: Locale = "zh-CN";
export const supportedLocales = localeSchema.options;
export const localeLabels: Record<Locale, string> = {
  "zh-CN": "中文",
  "en-US": "English",
};

export { m } from "./paraglide/messages.js";
export { getLocale, isLocale, setLocale } from "./paraglide/runtime.js";

export function resolveLocale(value: string | undefined): Locale {
  const result = localeSchema.safeParse(value);
  return result.success ? result.data : defaultLocale;
}
