import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

/**
 * Action hierarchy. Each rank has its own silhouette so importance reads
 * before the label does:
 *   primary    solid ink, with a lamp tick: the one main action on a screen
 *   secondary  ink outline: a real alternative
 *   ghost      quiet tinted hover: tertiary, toolbar-level
 *   text       underlined words: inline, low-stakes
 *   danger     coral outline that fills on hover: destructive, never the default
 */
export function Button({
  variant = "primary",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "text" | "danger";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-11 text-sm font-semibold transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed";
  const shape = variant === "text" ? "" : "rounded-[var(--radius-control)]";
  const variants: Record<string, string> = {
    primary:
      "bg-brand text-on-navy hover:bg-navy-600 active:bg-navy-500 shadow-[inset_0_-3px_0_var(--color-lamp)]",
    secondary:
      "bg-transparent text-ink-950 border-[1.5px] border-ink-950 hover:bg-ink-950 hover:text-paper-50",
    ghost: "text-ink-800 hover:bg-surface-hover hover:text-ink-950",
    text: "!px-1 !min-h-10 text-ink-950 underline underline-offset-4 decoration-2 decoration-lamp hover:bg-lamp hover:text-on-lamp hover:no-underline",
    danger:
      "bg-transparent text-seal-coral-700 border-[1.5px] border-seal-coral-600 hover:bg-seal-coral-600 hover:text-white",
  };
  return (
    <button className={`${base} ${shape} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

/** Square icon-only control. `label` becomes the accessible name and tooltip. */
export function IconButton({
  label,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-[var(--radius-control)] text-ink-700 hover:text-ink-950 hover:bg-surface-hover transition-colors ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * A bordered panel. Use it sparingly: grouping by alignment, dividers and
 * spacing is preferred, and panels should never nest inside panels.
 */
export function Card({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`bg-surface border border-line rounded-[var(--radius-card)] ${className}`}>
      {children}
    </div>
  );
}

const fieldBase =
  "h-11 rounded-[var(--radius-control)] border-[1.5px] px-3.5 text-sm bg-surface text-ink-900 placeholder:text-ink-400 outline-none transition-colors";

export function Input(props: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string }) {
  const { label, hint, error, className = "", id, ...rest } = props;
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-semibold text-ink-800">
          {label}
        </label>
      )}
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        className={`${fieldBase} ${
          error ? "border-seal-coral-600" : "border-line-strong focus:border-ink-950"
        } ${className}`}
        {...rest}
      />
      {hint && !error && <span className="text-xs text-ink-500">{hint}</span>}
      {error && <span className="text-xs font-medium text-seal-coral-700">{error}</span>}
    </div>
  );
}

export function Select({
  label,
  className = "",
  id,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-semibold text-ink-800">
          {label}
        </label>
      )}
      <select id={id} className={`${fieldBase} border-line-strong focus:border-ink-950 ${className}`} {...rest}>
        {children}
      </select>
    </div>
  );
}

/**
 * A short status tag. Meaning is carried by the words and the leading mark
 * shape, not by the hue alone: neutral = plain, lamp = current/active,
 * the rest = tiered attention.
 */
export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "teal" | "amber" | "coral" | "violet";
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-paper-200 text-ink-800",
    teal: "bg-seal-teal-100 text-seal-teal-900",
    amber: "bg-seal-amber-100 text-seal-amber-900",
    coral: "bg-seal-coral-100 text-seal-coral-900",
    violet: "bg-lamp text-on-lamp",
  };
  const marks: Record<string, string> = { neutral: "○", teal: "●", amber: "◐", coral: "▲", violet: "◆" };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-chip)] text-xs font-semibold ${tones[tone]}`}
    >
      <span aria-hidden="true" className="text-[8px] leading-none">
        {marks[tone]}
      </span>
      {children}
    </span>
  );
}

/** Nothing here yet: says what the space is for and offers the next step. */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 py-10 px-1">
      <div aria-hidden="true" className="self-stretch w-1 rounded-full bg-lamp shrink-0" />
      <div className="flex flex-col items-start gap-2.5">
        {icon && <div className="text-ink-500 text-lg">{icon}</div>}
        <h3 className="text-xl font-semibold text-ink-950">{title}</h3>
        {body && <p className="text-sm text-ink-500 max-w-md">{body}</p>}
        {action && <div className="mt-1">{action}</div>}
      </div>
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-[var(--radius-chip)] bg-paper-200 ${className}`} />;
}

/** Loading row: mirrors the document-row layout (date stamp + text) so the page does not jump. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="border-t border-line py-4 flex gap-4">
      <Skeleton className="w-12 h-14 shrink-0" />
      <div className="flex-1 flex flex-col gap-2.5 min-w-0">
        <Skeleton className="h-4 w-2/5" />
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={`h-3 ${i === lines - 1 ? "w-1/3" : "w-full"}`} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonList({ count = 4, lines = 2 }: { count?: number; lines?: number }) {
  return (
    <div role="status" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} lines={lines} />
      ))}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 bg-seal-coral-50 border-[1.5px] border-seal-coral-600 text-seal-coral-900 rounded-[var(--radius-control)] px-4 py-3 text-sm"
    >
      <span className="min-w-0 flex items-start gap-2.5">
        <span aria-hidden="true" className="font-bold">
          ▲
        </span>
        {message}
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 min-h-10 px-4 rounded-[var(--radius-control)] border-[1.5px] border-seal-coral-600 font-semibold hover:bg-seal-coral-600 hover:text-white"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * Page head. A lamp tab sits on the title baseline: the same mark the
 * navigation uses for "you are here", so the page answers WHERE AM I? twice.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-8 pb-5 border-b border-line">
      <div className="min-w-0">
        {eyebrow && <span className="label-caps">{eyebrow}</span>}
        <h1 className="text-3xl md:text-4xl font-bold text-ink-950 mt-1 leading-tight">{title}</h1>
        <span aria-hidden="true" className="block h-1.5 w-14 bg-lamp mt-3 rounded-[var(--radius-chip)]" />
        {description && <p className="text-ink-500 mt-3 max-w-2xl text-sm md:text-base">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Section heading inside a page: title with a trailing count or action, over a rule. */
export function SectionHead({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line-strong pb-2 mb-1">
      <h2 className="text-lg font-semibold text-ink-950">{title}</h2>
      {aside && <div className="data text-ink-500">{aside}</div>}
    </div>
  );
}
