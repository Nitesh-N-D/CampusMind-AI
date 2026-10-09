import { useThemeStore, type Theme } from "@/lib/themeStore";
import { useT } from "@/lib/i18n";

const ORDER: Theme[] = ["light", "dark", "system"];

/**
 * Light / Dark / System as a labelled segmented control (text, not icon-only,
 * so the choice is never ambiguous). With `compactOnMobile` it collapses to a
 * single button that cycles through the options below the `sm` breakpoint.
 */
export function ThemeToggle({ compactOnMobile = false }: { compactOnMobile?: boolean }) {
  const { theme, setTheme } = useThemeStore();
  const t = useT();
  const label: Record<Theme, string> = {
    light: t("theme.light"),
    dark: t("theme.dark"),
    system: t("theme.system"),
  };
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];

  return (
    <>
      {compactOnMobile && (
        <button
          type="button"
          onClick={() => setTheme(next)}
          aria-label={`${t("theme.label")}: ${label[theme]}`}
          title={`${t("theme.label")}: ${label[theme]}`}
          className="sm:hidden min-h-10 px-3 text-xs font-semibold rounded-[var(--radius-control)] border border-line-strong bg-surface text-ink-800"
        >
          {label[theme]}
        </button>
      )}
      <div
        role="radiogroup"
        aria-label={t("theme.label")}
        className={`${compactOnMobile ? "hidden sm:inline-flex" : "inline-flex"} items-stretch rounded-[var(--radius-control)] border border-line-strong bg-surface overflow-hidden`}
      >
        {ORDER.map((option) => {
          const active = theme === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(option)}
              className={`min-h-9 px-3 text-xs font-semibold transition-colors ${
                active ? "bg-lamp text-on-lamp" : "text-ink-700 hover:bg-surface-hover hover:text-ink-950"
              }`}
            >
              {label[option]}
            </button>
          );
        })}
      </div>
    </>
  );
}
