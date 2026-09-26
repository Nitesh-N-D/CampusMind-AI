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
    "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 py-2.5 text-sm font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2";
  const variants: Record<string, string> = {
    primary: "bg-navy-700 text-on-navy hover:bg-navy-900 active:bg-ink-950",
    secondary:
      "bg-surface text-ink-900 border border-line-strong hover:border-ink-400 hover:text-ink-950",
    ghost: "text-ink-700 hover:bg-paper-200",
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
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${tones[tone]}`}>
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
    <div className="flex flex-col items-center text-center gap-3 py-16 px-6">
      {icon && (
        <div className="w-12 h-12 rounded-full bg-paper-200 flex items-center justify-center text-ink-500 text-xl">
          {icon}
        </div>
      )}
      <h3 className="font-display text-lg text-ink-900">{title}</h3>
      {body && <p className="text-sm text-ink-500 max-w-sm">{body}</p>}
      {action}
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
      <Skeleton className="w-[52px] h-[52px] rounded-full shrink-0" />
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
    <div className="flex items-center justify-between gap-3 bg-seal-coral-50 border border-seal-coral-100 text-seal-coral-900 rounded-[var(--radius-control)] px-4 py-3 text-sm">
      <span>{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="font-medium underline underline-offset-2 shrink-0">
          Retry
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
    <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
      <div>
        {eyebrow && (
          <span className="text-xs font-medium uppercase tracking-wider text-violet-600">{eyebrow}</span>
        )}
        <h1 className="font-display text-2xl md:text-3xl text-ink-950 mt-1">{title}</h1>
        {description && <p className="text-ink-500 mt-2 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
