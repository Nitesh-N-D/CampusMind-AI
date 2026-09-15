export function Wordmark({ className = "", dark = false }: { className?: string; dark?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 font-display font-semibold tracking-tight ${className}`}
      style={{ color: dark ? "var(--color-paper-50)" : "var(--color-navy-900)" }}
    >
      <MarkIcon dark={dark} />
      CampusMind <span style={{ color: "var(--color-violet-500)" }}>AI</span>
    </span>
  );
}

export function MarkIcon({ size = 22, dark = false }: { size?: number; dark?: boolean }) {
  const ring = dark ? "var(--color-paper-100)" : "var(--color-navy-900)";
  const accent = "var(--color-violet-500)";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="14" stroke={ring} strokeWidth="1.6" />
      <circle cx="16" cy="16" r="9.5" stroke={ring} strokeWidth="1" opacity="0.4" />
      <path
        d="M16 8.5 L21.5 12 V19 L16 22.5 L10.5 19 V12 Z"
        stroke={accent}
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="16" cy="15.6" r="1.6" fill={accent} />
    </svg>
  );
}
