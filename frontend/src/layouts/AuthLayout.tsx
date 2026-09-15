import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Wordmark } from "@/components/Brand";
import { ThemeToggle } from "@/components/ThemeToggle";

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
    <div className="min-h-screen bg-paper-100 flex flex-col">
      <header className="h-16 flex items-center justify-between px-4 sm:px-6">
        <Link to="/">
          <Wordmark />
        </Link>
        <ThemeToggle />
      </header>
      <div className="flex-1 flex items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md">
          <div className="mb-7 text-center">
            <h1 className="font-display text-2xl text-ink-950">{title}</h1>
            {subtitle && <p className="text-sm text-ink-500 mt-2">{subtitle}</p>}
          </div>
          <div className="bg-surface border border-line rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-6 sm:p-8">
            {children}
          </div>
          {footer && <div className="text-center text-sm text-ink-500 mt-5">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
