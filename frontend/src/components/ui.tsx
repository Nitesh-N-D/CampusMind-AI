import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function Button({
  variant = "primary",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 py-2.5 min-h-10 text-sm font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2";
  const variants: Record<string, string> = {
    primary: "bg-brand text-on-navy hover:bg-navy-600 active:bg-navy-500",
    secondary:
      "bg-surface text-ink-900 border border-line-strong hover:border-ink-400 hover:text-ink-950",
    ghost: "text-ink-700 hover:bg-surface-hover",
    danger: "bg-seal-coral-600 text-white hover:brightness-110",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Card({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`bg-surface border border-line rounded-[var(--radius-card)] shadow-[var(--shadow-card)] ${className}`}
    >
      {children}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string }) {
  const { label, hint, error, className = "", id, ...rest } = props;
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-ink-800">
          {label}
        </label>
      )}
      <input
        id={id}
        className={`h-11 rounded-[var(--radius-control)] border px-3.5 text-sm bg-surface text-ink-900 placeholder:text-ink-400 outline-none transition-colors ${
          error ? "border-seal-coral-600" : "border-line-strong focus:border-violet-500"
        } ${className}`}
        {...rest}
      />
      {hint && !error && <span className="text-xs text-ink-500">{hint}</span>}
      {error && <span className="text-xs text-seal-coral-700">{error}</span>}
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
        <label htmlFor={id} className="text-sm font-medium text-ink-800">
          {label}
        </label>
      )}
      <select
        id={id}
        className={`h-11 rounded-[var(--radius-control)] border border-line-strong px-3.5 text-sm bg-surface text-ink-900 outline-none focus:border-violet-500 ${className}`}
        {...rest}
      >
        {children}
      </select>
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "teal" | "amber" | "coral" | "violet";
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-paper-200 text-ink-700",
    teal: "bg-seal-teal-100 text-seal-teal-900",
    amber: "bg-seal-amber-100 text-seal-amber-900",
    coral: "bg-seal-coral-100 text-seal-coral-900",
    violet: "bg-violet-100 text-violet-600",
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-[3px] font-mono text-[11px] uppercase tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

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
    <div className="flex flex-col items-start gap-3 py-12 px-6 sm:px-8 border border-dashed border-line-strong rounded-[var(--radius-card)] bg-surface-2/60">
      {icon && (
        <div className="w-10 h-10 rounded-[var(--radius-control)] bg-paper-200 flex items-center justify-center text-ink-500 text-lg">
          {icon}
        </div>
      )}
      <h3 className="font-display text-lg text-ink-900">{title}</h3>
      {body && <p className="text-sm text-ink-500 max-w-md">{body}</p>}
      {action && <div className="mt-1">{action}</div>}
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
  return <div className={`animate-pulse rounded-[var(--radius-control)] bg-paper-200 ${className}`} />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="bg-surface border border-line rounded-[var(--radius-card)] p-5 flex gap-4">
      <Skeleton className="w-[52px] h-[52px] rounded-[var(--radius-control)] shrink-0" />
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
    <div className="flex flex-col gap-3">
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
      className="flex flex-wrap items-center justify-between gap-3 bg-seal-coral-50 border border-seal-coral-100 border-l-4 border-l-seal-coral-600 text-seal-coral-900 rounded-[var(--radius-control)] px-4 py-3 text-sm"
    >
      <span className="min-w-0">{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 min-h-9 px-3 rounded-[var(--radius-control)] border border-seal-coral-600 font-medium hover:bg-seal-coral-100"
        >
          Try again
        </button>
      )}
    </div>
  );
}

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
        {eyebrow && <span className="label-caps text-violet-600">{eyebrow}</span>}
        <h1 className="font-display text-2xl md:text-[1.75rem] text-ink-950 mt-1">{title}</h1>
        {description && <p className="text-ink-500 mt-2 max-w-2xl text-sm md:text-base">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
