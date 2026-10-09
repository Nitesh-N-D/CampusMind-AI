/**
 * Trust, shown as a four-step staircase plus a spoken label.
 *
 * Steps (not a ring or a bare percentage) so confidence reads at a glance,
 * and the count of filled steps carries the meaning even without colour:
 *   Verified 4 · High 3 · Moderate 2 · Low 1 · Insufficient evidence 0
 * The numeric score stays available as small data beside the steps.
 *
 * (File and `Seal` export keep their historical names so call sites are
 * unchanged; `TrustMeter` is the preferred name.)
 */
export type TrustLevel = "very_high" | "high" | "medium" | "low" | "none";

const TIER: Record<TrustLevel, { steps: number; color: string; text: string; label: string }> = {
  very_high: { steps: 4, color: "var(--color-seal-teal-600)", text: "var(--color-seal-teal-900)", label: "Verified" },
  high: { steps: 3, color: "var(--color-seal-teal-600)", text: "var(--color-seal-teal-900)", label: "High" },
  medium: { steps: 2, color: "var(--color-seal-amber-600)", text: "var(--color-seal-amber-900)", label: "Moderate" },
  low: { steps: 1, color: "var(--color-seal-coral-600)", text: "var(--color-seal-coral-900)", label: "Low" },
  none: { steps: 0, color: "var(--color-line-strong)", text: "var(--color-ink-700)", label: "Insufficient evidence" },
};

const SIZES = {
  sm: { w: 5, gap: 2, h: [6, 10, 14, 18] },
  md: { w: 7, gap: 3, h: [8, 14, 20, 26] },
  lg: { w: 10, gap: 4, h: [12, 20, 28, 36] },
};

export function trustLabel(level: TrustLevel): string {
  return (TIER[level] ?? TIER.medium).label;
}

export function TrustMeter({
  score,
  level,
  size = "md",
  showLabel = false,
  showScore = true,
  className = "",
}: {
  score?: number;
  level: TrustLevel;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  showScore?: boolean;
  className?: string;
}) {
  const tier = TIER[level] ?? TIER.medium;
  const dim = SIZES[size];
  const clamped = typeof score === "number" ? Math.max(0, Math.min(100, Math.round(score))) : null;
  const width = dim.w * 4 + dim.gap * 3;
  const description =
    clamped !== null && level !== "none"
      ? `Trust: ${tier.label}, score ${clamped} out of 100`
      : `Trust: ${tier.label}`;

  return (
    <div className={`inline-flex items-end gap-2 ${className}`} role="img" aria-label={description} title={description}>
      <svg width={width} height={dim.h[3]} viewBox={`0 0 ${width} ${dim.h[3]}`} aria-hidden="true" className="shrink-0">
        {dim.h.map((h, i) => (
          <rect
            key={i}
            x={i * (dim.w + dim.gap)}
            y={dim.h[3] - h}
            width={dim.w}
            height={h}
            rx={1}
            fill={i < tier.steps ? tier.color : "none"}
            stroke={i < tier.steps ? tier.color : "var(--color-line-strong)"}
            strokeWidth={1.25}
            className={i < tier.steps ? "animate-step" : undefined}
            style={i < tier.steps ? { animationDelay: `${i * 60}ms` } : undefined}
          />
        ))}
      </svg>
      {(showLabel || (showScore && clamped !== null && level !== "none")) && (
        <span className="flex flex-col leading-tight">
          {showLabel && (
            <span className="text-xs font-semibold" style={{ color: tier.text }}>
              {tier.label}
            </span>
          )}
          {showScore && clamped !== null && level !== "none" && (
            <span className="data text-ink-500">{clamped}/100</span>
          )}
        </span>
      )}
    </div>
  );
}

/** Historical name for TrustMeter. */
export const Seal = TrustMeter;
