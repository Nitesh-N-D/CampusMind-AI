import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/lib/authStore";
import { useCommandPaletteStore } from "@/lib/commandPaletteStore";

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  action: () => void;
}

export function CommandPalette() {
  const { open, setOpen, toggle } = useCommandPaletteStore();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const navigate = useNavigate();
  const { isAuthenticated, role, logout } = useAuthStore();

  const commands = useMemo<Command[]>(() => {
    if (!isAuthenticated) return [];
    const nav = (path: string, label: string, group = "Go to") => ({
      id: path,
      label,
      group,
      action: () => navigate(path),
    });
    const base: Command[] = [
      nav("/chat", "Ask CampusMind"),
      nav("/search", "Search documents"),
      nav("/timeline", "Timeline"),
      nav("/what-changed", "What changed?"),
      nav("/documents", "Documents"),
      nav("/profile", "Profile"),
    ];
    if (role === "admin") {
      base.push(nav("/admin", "Knowledge health"), nav("/admin/conflicts", "Conflicts"));
    }
    base.push({
      id: "new-chat",
      label: "Start a new conversation",
      group: "Actions",
      action: () => navigate("/chat"),
    });
    base.push({
      id: "sign-out",
      label: "Sign out",
      group: "Actions",
      action: () => {
        logout();
        navigate("/login");
      },
    });
    return base;
  }, [isAuthenticated, role, navigate, logout]);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const modifierPressed = isMac ? e.metaKey : e.ctrlKey;
      if (modifierPressed && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open || !isAuthenticated) return null;

  const runActive = () => {
    const cmd = filtered[activeIndex];
    if (cmd) {
      cmd.action();
      setOpen(false);
    }
  };

  const groups = Array.from(new Set(filtered.map((c) => c.group)));

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-24 px-4">
      <button
        aria-label="Close command palette"
        className="absolute inset-0 bg-black/40"
        onClick={() => setOpen(false)}
      />
      <div className="relative w-full max-w-lg bg-surface border border-line rounded-[var(--radius-card)] shadow-[var(--shadow-raised)] overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 border-b border-line">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-ink-400 shrink-0" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" strokeWidth="1.6" />
            <path d="m20 20-4.3-4.3" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a page or run an action..."
            className="flex-1 h-12 bg-transparent outline-none text-sm text-ink-900 placeholder:text-ink-400"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                runActive();
              }
            }}
          />
          <kbd className="text-[10px] text-ink-400 border border-line-strong rounded px-1.5 py-0.5">esc</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto py-2">
          {filtered.length === 0 && (
            <p className="text-sm text-ink-400 text-center py-8">No matching pages or actions.</p>
          )}
          {groups.map((group) => (
            <div key={group} className="mb-1">
              <p className="text-[11px] font-medium text-ink-400 uppercase tracking-wide px-4 py-1.5">{group}</p>
              {filtered
                .filter((c) => c.group === group)
                .map((c) => {
                  const idx = filtered.indexOf(c);
                  return (
                    <button
                      key={c.id}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => {
                        c.action();
                        setOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                        idx === activeIndex ? "bg-violet-50 text-violet-600" : "text-ink-800"
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
