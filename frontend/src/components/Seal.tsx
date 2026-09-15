export type TrustLevel = "very_high" | "high" | "medium" | "low";

const TIER: Record<
  TrustLevel,
  { ring: string; fill: string; text: string; label: string; bg: string }
> = {
  very_high: {
    ring: "var(--color-seal-teal-600)",
    fill: "var(--color-seal-teal-50)",
    text: "var(--color-seal-teal-900)",
    bg: "var(--color-seal-teal-100)",
    label: "Verified",
  },
  high: {
    ring: "var(--color-seal-teal-600)",
    fill: "var(--color-seal-teal-50)",
    text: "var(--color-seal-teal-900)",
    bg: "var(--color-seal-teal-100)",
    label: "High trust",
  },
  medium: {
    ring: "var(--color-seal-amber-600)",
    fill: "var(--color-seal-amber-50)",
    text: "var(--color-seal-amber-900)",
    bg: "var(--color-seal-amber-100)",
    label: "Use with caution",
  },
  low: {
    ring: "var(--color-seal-coral-600)",
    fill: "var(--color-seal-coral-50)",
    text: "var(--color-seal-coral-900)",
    bg: "var(--color-seal-coral-100)",
    label: "Unverified",
  },
};

const SIZES = {
  sm: { box: 36, stroke: 3, font: 10 },
  md: { box: 52, stroke: 3.5, font: 13 },
  lg: { box: 72, stroke: 4, font: 17 },
};

export function Seal({
  score,
  level,
  size = "md",
  showLabel = false,
  className = "",
}: {
  score: number;
  level: TrustLevel;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}) {
  const tier = TIER[level] ?? TIER.medium;
  const dim = SIZES[size];
  const r = dim.box / 2 - dim.stroke * 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const dash = (clamped / 100) * circumference;
  const tickCount = 24;

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <div
        className="relative shrink-0"
        style={{ width: dim.box, height: dim.box }}
        role="img"
        aria-label={`Source confidence ${clamped} percent, ${tier.label}`}
      >
        <svg width={dim.box} height={dim.box} viewBox={`0 0 ${dim.box} ${dim.box}`}>
          <title>{`Source confidence ${clamped}%`}</title>
          {/* stamp ticks */}
          {Array.from({ length: tickCount }).map((_, i) => {
            const angle = (i / tickCount) * Math.PI * 2;
            const inner = dim.box / 2 - dim.stroke * 0.9;
            const outer = dim.box / 2 - dim.stroke * 2.1;
            const x1 = dim.box / 2 + inner * Math.cos(angle);
            const y1 = dim.box / 2 + inner * Math.sin(angle);
            const x2 = dim.box / 2 + outer * Math.cos(angle);
            const y2 = dim.box / 2 + outer * Math.sin(angle);
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="var(--color-line)"
                strokeWidth={1}
              />
            );
          })}
          <circle
            cx={dim.box / 2}
            cy={dim.box / 2}
            r={r}
            fill={tier.fill}
            stroke="var(--color-line)"
            strokeWidth={1}
          />
          <circle
            cx={dim.box / 2}
            cy={dim.box / 2}
            r={r}
            fill="none"
            stroke={tier.ring}
            strokeWidth={dim.stroke}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${dim.box / 2} ${dim.box / 2})`}
            style={{ transition: "stroke-dasharray 0.5s ease" }}
          />
        </svg>
        <div
          className="absolute inset-0 flex items-center justify-center font-medium"
          style={{ color: tier.text, fontFamily: "var(--font-mono)", fontSize: dim.font }}
        >
          {clamped}
        </div>
      </div>
      {showLabel && (
        <div className="flex flex-col leading-tight">
          <span
            className="text-xs font-medium px-1.5 py-0.5 rounded w-fit"
            style={{ background: tier.bg, color: tier.text }}
          >
            {tier.label}
          </span>
          <span className="text-[11px] text-ink-400 mt-1" style={{ fontFamily: "var(--font-mono)" }}>
            confidence {clamped}%
          </span>
        </div>
      )}
    </div>
  );
}

export function trustLabel(level: TrustLevel): string {
  return TIER[level]?.label ?? "Unrated";
}
