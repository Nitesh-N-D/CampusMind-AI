import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/lib/authStore";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSelector } from "@/components/LanguageSelector";
import { api } from "@/lib/api";
import { detachThisDevice } from "@/lib/pushClient";

const ROLE_LABEL: Record<string, string> = {
  admin: "Workspace admin",
  student: "Student",
  faculty: "Faculty",
};

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0]?.slice(0, 2) ?? "?";
  return letters.toUpperCase();
}

/**
 * The avatar button in the top-right of every signed-in page. It's the one
 * place for account actions: profile, theme, and signing out.
 */
export function UserMenu() {
  const { role, fullName, collegeName, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [nickname, setNickname] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.profile
      .me()
      .then((p) => setNickname(p.nickname))
      .catch(() => {
        // Non-fatal - the menu falls back to the name from login.
      });
  }, []);

  // Close on navigation, outside click, and Escape.
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (e.key === "Tab" && !(e.target as HTMLElement).closest("[data-menu-controls]")) {
      setOpen(false);
    }
  };

  const displayName = nickname || fullName;
  const itemClass =
    "w-full flex items-center gap-3 px-3 py-2 text-sm text-left text-ink-800 rounded-[6px] hover:bg-surface-hover focus:bg-surface-hover outline-none";

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${displayName ?? "your account"}`}
        className="flex items-center gap-2 rounded-full p-0.5 pr-0.5 sm:pr-2.5 hover:bg-surface-hover transition-colors"
      >
        <span
          className="w-8 h-8 rounded-full bg-violet-500 text-on-navy text-xs font-semibold flex items-center justify-center"
          aria-hidden="true"
        >
          {initials(displayName)}
        </span>
        <span className="hidden sm:block max-w-[10rem] truncate text-sm text-ink-800">{displayName}</span>
        <svg
          className="hidden sm:block text-ink-400"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 mt-2 w-64 bg-surface border border-line rounded-[var(--radius-card)] shadow-[var(--shadow-raised)] p-1.5 z-50"
          style={{ animation: "fadeIn 120ms ease-out" }}
        >
          <div className="px-3 py-2.5 border-b border-line mb-1.5">
            <p className="text-sm font-medium text-ink-950 truncate">{displayName}</p>
            <p className="text-xs text-ink-500 truncate mt-0.5">
              {ROLE_LABEL[role ?? ""] ?? role}
              {collegeName ? ` · ${collegeName}` : ""}
            </p>
          </div>
          <Link to="/profile" role="menuitem" className={itemClass}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <circle cx="12" cy="8" r="3.4" strokeWidth="1.6" />
              <path d="M5 20c1.2-4 4-6 7-6s5.8 2 7 6" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            Profile
          </Link>
          <div className="border-t border-line my-1.5" />
          {/* Appearance + language. Tab moves through these without closing the menu. */}
          <div data-menu-controls className="px-3 py-2 flex items-center justify-between gap-2">
            <ThemeToggle />
            <LanguageSelector className="min-w-0" />
          </div>
          <div className="border-t border-line my-1.5" />
          <button
            role="menuitem"
            onClick={async () => {
              // Stop background pushes to this browser while the token is
              // still valid, but never make sign-out wait long for it.
              await Promise.race([detachThisDevice(), new Promise((resolve) => setTimeout(resolve, 1500))]);
              logout();
              navigate("/login");
            }}
            className={itemClass}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="M9 4H5v16h4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M15 8l4 4-4 4M19 12H9" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
