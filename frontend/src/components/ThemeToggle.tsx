import { useThemeStore, type ThemePreference } from "@/lib/themeStore";
import { useT } from "@/lib/i18n";

const ICONS: Record<ThemePreference, React.ReactNode> = {
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
  system: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2" strokeWidth="1.6" />
      <path d="M9 20h6M12 16.5V20" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
};

const ORDER: ThemePreference[] = ["light", "system", "dark"];

/**
 * Three-way segmented control: Light / System / Dark. With `compactOnMobile`
 * it collapses to one button that cycles through the options below the `sm`
 * breakpoint, for headers too narrow to fit all three.
 */
export function ThemeToggle({ compactOnMobile = false }: { compactOnMobile?: boolean }) {
  const { preference, setPreference } = useThemeStore();
  const t = useT();
  const label: Record<ThemePreference, string> = {
    light: t("theme.light"),
    dark: t("theme.dark"),
    system: t("theme.system"),
  };
  const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length];

  return (
    <>
      {compactOnMobile && (
        <button
          type="button"
          onClick={() => setPreference(next)}
          aria-label={`${t("theme.label")}: ${label[preference]}`}
          title={`${t("theme.label")}: ${label[preference]}`}
          className="sm:hidden w-9 h-9 flex items-center justify-center rounded-full border border-line bg-surface-2 text-ink-700 hover:text-ink-950"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            {ICONS[preference]}
          </svg>
        </button>
      )}
      <ThemeGroup
        label={label}
        className={compactOnMobile ? "hidden sm:inline-flex" : "inline-flex"}
      />
    </>
  );
}

function ThemeGroup({ label, className }: { label: Record<ThemePreference, string>; className: string }) {
  const { preference, setPreference } = useThemeStore();
  const t = useT();

  return (
    <div
      role="radiogroup"
      aria-label={t("theme.label")}
      className={`${className} items-center gap-0.5 rounded-full border border-line bg-surface-2 p-0.5`}
    >
      {ORDER.map((option) => {
        const active = preference === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label[option]}
            title={label[option]}
            onClick={() => setPreference(option)}
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
