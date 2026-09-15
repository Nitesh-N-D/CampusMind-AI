import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/Brand";
import { ThemeToggle } from "@/components/ThemeToggle";

export function LegalLayout({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper-100">
      <header className="border-b border-line bg-surface sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link to="/">
            <Wordmark className="text-sm sm:text-base" />
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14">
        <h1 className="font-display text-3xl text-ink-950">{title}</h1>
        <p className="text-sm text-ink-400 mt-2" style={{ fontFamily: "var(--font-mono)" }}>
          Last updated {updated}
        </p>
        <div className="prose-legal mt-8 flex flex-col gap-6 text-sm text-ink-700 leading-relaxed">
          {children}
        </div>
        <div className="mt-14 pt-6 border-t border-line">
          <Link to="/" className="text-sm text-violet-600 font-medium hover:underline">
            &larr; Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
