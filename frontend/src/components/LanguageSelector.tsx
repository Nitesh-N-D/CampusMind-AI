import { LANGUAGES, useLanguageStore, useT, type LanguageCode } from "@/lib/i18n";

/** Interface-language picker. The choice persists in localStorage and also
 * sets the default answer language in chat. */
export function LanguageSelector({ className = "" }: { className?: string }) {
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const t = useT();

  return (
    <select
      value={language}
      onChange={(e) => setLanguage(e.target.value as LanguageCode)}
      aria-label={t("lang.label")}
      title={t("lang.label")}
      className={`h-9 text-xs border border-line rounded-[var(--radius-control)] pl-3 pr-2 bg-surface-2 text-ink-800 hover:border-line-strong cursor-pointer ${className}`}
    >
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code} lang={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
