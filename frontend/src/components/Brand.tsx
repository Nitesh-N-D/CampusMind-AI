export function Wordmark({ className = "", dark = false }: { className?: string; dark?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 font-display font-bold tracking-tight ${className}`}
      style={{ color: dark ? "var(--color-on-navy)" : "var(--color-brand-ink)" }}
    >
      <MarkIcon dark={dark} />
      CampusMind
      <span className="px-1 py-px rounded-[var(--radius-chip)] bg-lamp text-on-lamp text-[0.65em] font-bold leading-tight">
        AI
      </span>
    </span>
  );
}

/** The mark: a tile with the CampusMind corner, a thread running down it, and the lamp node it ends on. */
export function MarkIcon({ size = 22, dark = false }: { size?: number; dark?: boolean }) {
  const ink = dark ? "var(--color-on-navy)" : "var(--color-brand-ink)";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M12 2h15a3 3 0 0 1 3 3v15a10 10 0 0 1-10 10H5a3 3 0 0 1-3-3V12A10 10 0 0 1 12 2Z" fill={ink} />
      <path d="M11 7v9" stroke="var(--color-lamp)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M11 16h8" stroke="var(--color-lamp)" strokeWidth="2.4" strokeLinecap="round" />
      <rect x="17.5" y="13.5" width="6" height="6" transform="rotate(45 20.5 16.5)" fill="var(--color-lamp)" />
    </svg>
  );
}
