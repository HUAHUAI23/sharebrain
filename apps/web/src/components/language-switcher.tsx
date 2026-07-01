import { getLocale, localeLabels, m, setLocale, supportedLocales, type Locale } from "@sharebrain/i18n";
import { Languages } from "lucide-react";

export function LanguageSwitcher() {
  const currentLocale = getLocale() as Locale;

  return (
    <div
      className="inline-flex min-h-7 items-center gap-0.5 rounded-md px-0.5 text-xs text-muted-foreground hover:bg-accent"
      aria-label={m.language_label()}
    >
      <Languages size={14} />
      {supportedLocales.map((locale) => {
        const label = localeLabels[locale];
        return (
          <button
            type="button"
            key={locale}
            className={
              locale === currentLocale
                ? "rounded-sm border-0 bg-accent px-2 py-1.5 text-foreground"
                : "rounded-sm border-0 bg-transparent px-2 py-1.5 text-inherit hover:bg-accent hover:text-foreground"
            }
            aria-label={locale === currentLocale ? m.language_current() : m.language_switch_to({ label })}
            aria-current={locale === currentLocale ? "true" : undefined}
            onClick={() => {
              if (locale !== currentLocale) {
                void setLocale(locale);
              }
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
