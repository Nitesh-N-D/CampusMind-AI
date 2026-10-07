import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Wordmark } from "@/components/Brand";
import { BackLink } from "@/components/BackLink";
import { ThemeToggle } from "@/components/ThemeToggle";

const STEPS = [
  { k: "01", title: "Official documents", body: "Regulations, circulars, timetables and notices your college uploads." },
  { k: "02", title: "Cited answers", body: "Every answer names the document and page it came from." },
  { k: "03", title: "Honest limits", body: "Conflicts are flagged and unanswered questions are logged for admins." },
];

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-paper-100 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Product context. Hidden on small screens, where the form comes first. */}
      <aside className="hidden lg:flex flex-col justify-between bg-navy-900 text-on-navy px-12 py-10 border-r border-line">
        <Link to="/" aria-label="CampusMind AI home">
          <Wordmark dark />
        </Link>
        <div>
          <span className="label-caps !text-on-navy-muted">Campus knowledge, with sources</span>
          <h2 className="font-display text-3xl leading-tight mt-3 max-w-sm">
            Answers your college can stand behind.
          </h2>
          <ol className="mt-10 border-t border-white/15">
            {STEPS.map((s) => (
              <li key={s.k} className="flex gap-5 py-4 border-b border-white/15">
                <span className="font-mono text-xs text-on-navy-muted pt-1">{s.k}</span>
                <div>
                  <p className="font-medium">{s.title}</p>
                  <p className="text-sm text-on-navy-muted mt-0.5">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <p className="text-xs text-on-navy-muted">Sign-in is limited to your college's approved email domains.</p>
      </aside>

      <div className="flex flex-col min-h-dvh lg:min-h-0">
        <header className="h-14 flex items-center justify-between px-4 sm:px-8">
          <BackLink />
          <div className="flex items-center gap-3">
            <Link to="/" className="lg:hidden" aria-label="CampusMind AI home">
              <Wordmark className="text-sm" />
            </Link>
            <ThemeToggle />
          </div>
        </header>
        <div className="flex-1 flex items-start lg:items-center justify-center px-4 sm:px-8 pt-6 pb-16">
          <div className="w-full max-w-md">
            <div className="mb-6">
              <h1 className="font-display text-2xl text-ink-950">{title}</h1>
              {subtitle && <p className="text-sm text-ink-500 mt-2">{subtitle}</p>}
            </div>
            <div className="bg-surface border border-line rounded-[var(--radius-card)] p-5 sm:p-7">{children}</div>
            {footer && <div className="text-sm text-ink-500 mt-5 leading-relaxed">{footer}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
