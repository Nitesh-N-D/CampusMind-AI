import { Link, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { usePageMeta } from "@/lib/usePageMeta";
import { Wordmark } from "@/components/Brand";
import { BackLink } from "@/components/BackLink";
import { ThemeToggle } from "@/components/ThemeToggle";

export function LegalLayout({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  const { pathname } = useLocation();
  usePageMeta({ title, path: pathname });
  return (
    <div className="min-h-dvh bg-paper-100">
      <header className="border-b border-line bg-surface sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link to="/">
            <Wordmark className="text-sm sm:text-base" />
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-4 pb-16">
        {/* Back sits above the title so it is visible without scrolling. */}
        <BackLink />
        <div className="mt-4 pb-6 border-b border-line">
          <span className="label-caps text-violet-600">{pathname === "/terms" ? "Terms" : "Privacy"}</span>
          <h1 className="font-display text-3xl text-ink-950 mt-1">{title}</h1>
          <p className="text-sm text-ink-500 mt-2 font-mono">Last updated {updated}</p>
        </div>
        <div className="mt-8 flex flex-col gap-8 text-sm text-ink-700 leading-relaxed [&_section]:pt-6 [&_section]:border-t [&_section]:border-line">
          {children}
        </div>
      </main>
    </div>
  );
}
