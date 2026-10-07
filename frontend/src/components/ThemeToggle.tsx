import { useThemeStore, type Theme } from "@/lib/themeStore";
import { useT } from "@/lib/i18n";

const ICONS: Record<Theme, React.ReactNode> = {
  light: (
    <>
      <circle cx="12" cy="12" r="4.5" strokeWidth="1.6" />
      <path
        d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </>
  ),
  dark: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" strokeWidth="1.6" strokeLinejoin="round" />,
};

const ORDER: Theme[] = ["light", "dark"];

/**
 * Two-way segmented control: Light / Dark. With `compactOnMobile` it collapses
 * to one button that flips the theme below the `sm` breakpoint, for headers
 * too narrow to fit both options.
 */
export function ThemeToggle({ compactOnMobile = false }: { compactOnMobile?: boolean }) {
  const { theme, toggle } = useThemeStore();
  const t = useT();
  const label: Record<Theme, string> = {
    light: t("theme.light"),
    dark: t("theme.dark"),
  };

  return (
    <>
      {compactOnMobile && (
        <button
          type="button"
          onClick={toggle}
          aria-label={`${t("theme.label")}: ${label[theme]}`}
          title={`${t("theme.label")}: ${label[theme]}`}
          className="sm:hidden w-9 h-9 flex items-center justify-center rounded-full border border-line bg-surface-2 text-ink-700 hover:text-ink-950"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            {ICONS[theme]}
          </svg>
        </button>
      )}
      <ThemeGroup label={label} className={compactOnMobile ? "hidden sm:inline-flex" : "inline-flex"} />
    </>
  );
}

function ThemeGroup({ label, className }: { label: Record<Theme, string>; className: string }) {
  const { theme, setTheme } = useThemeStore();
  const t = useT();

  return (
    <div
      role="radiogroup"
      aria-label={t("theme.label")}
      className={`${className} items-center gap-0.5 rounded-full border border-line bg-surface-2 p-0.5`}
    >
      {ORDER.map((option) => {
        const active = theme === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label[option]}
            title={label[option]}
            onClick={() => setTheme(option)}
            className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
              active
                ? "bg-surface text-violet-600 shadow-[var(--shadow-card)]"
                : "text-ink-500 hover:text-ink-900"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              {ICONS[option]}
            </svg>
          </button>
        );
      })}
    </div>
  );
}
