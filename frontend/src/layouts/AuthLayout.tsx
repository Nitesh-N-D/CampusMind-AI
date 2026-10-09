import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Wordmark } from "@/components/Brand";
import { BackLink } from "@/components/BackLink";
import { ThemeToggle } from "@/components/ThemeToggle";

const STEPS = [
  { title: "Official documents", body: "Regulations, circulars, timetables and notices your college uploads." },
  { title: "Cited answers", body: "Every answer names the document and page it came from." },
  { title: "Honest limits", body: "Conflicts are flagged and unanswered questions are logged for admins." },
];

/**
 * Entry screens (sign in, registration). One column that reads top to bottom
 * like the product does: who you are -> the form -> what you get. No dark
 * marketing panel; the form sits on a lamp-shadowed panel and the promises
 * hang from a thread beside it on wide screens, below it on phones.
 */
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
    <div className="min-h-dvh bg-paper-100 flex flex-col">
      <header className="h-14 flex items-center justify-between gap-3 px-4 sm:px-8 max-w-6xl w-full mx-auto">
        <BackLink />
        <div className="flex items-center gap-3">
          <Link to="/" aria-label="CampusMind AI home" className="hidden sm:block">
            <Wordmark className="text-sm" />
          </Link>
          <ThemeToggle compactOnMobile />
        </div>
      </header>

      <div className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-8 pt-4 pb-16 grid lg:grid-cols-[minmax(0,32rem)_minmax(0,1fr)] gap-10 lg:gap-20 items-start">
        <div className="min-w-0">
          <Link to="/" aria-label="CampusMind AI home" className="sm:hidden inline-block mb-5">
            <Wordmark className="text-sm" />
          </Link>
          <h1 className="text-3xl sm:text-4xl font-bold text-ink-950 leading-tight">{title}</h1>
          <span aria-hidden="true" className="block h-1.5 w-14 bg-lamp mt-3 rounded-[var(--radius-chip)]" />
          {subtitle && <p className="text-sm sm:text-base text-ink-700 mt-3">{subtitle}</p>}
          <div className="mt-6 bg-surface border-[1.5px] border-ink-950 rounded-[var(--radius-card)] p-5 sm:p-7 shadow-[6px_6px_0_var(--color-lamp)]">
            {children}
          </div>
          {footer && <div className="text-sm text-ink-700 mt-7 leading-relaxed">{footer}</div>}
        </div>

        <aside aria-label="About CampusMind AI" className="lg:pt-24 min-w-0">
          <p className="label-caps">Campus knowledge, with sources</p>
          <ol className="thread thread-list mt-3 space-y-6">
            {STEPS.map((s) => (
              <li key={s.title} className="relative flex gap-3">
                <span className="thread-node mt-0.5 z-[1] bg-paper-100">
                  <span className="block w-3 h-3 rotate-45 bg-lamp outline outline-1 outline-ink-950" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-semibold text-ink-950">{s.title}</p>
                  <p className="text-sm text-ink-700 mt-0.5 max-w-sm">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="text-xs text-ink-500 mt-8 max-w-sm">Sign-in is limited to your college's approved email domains.</p>
        </aside>
      </div>
    </div>
  );
}
