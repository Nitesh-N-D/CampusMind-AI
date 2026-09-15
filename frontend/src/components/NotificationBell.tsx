import { useEffect, useRef, useState } from "react";
import { api, ApiError, type NotificationOut } from "@/lib/api";
import { Spinner } from "@/components/ui";

const CATEGORY_ICON: Record<string, string> = {
  conflict: "⚠",
  regulation_change: "↻",
  new_document: "＋",
  general: "•",
};

export function NotificationBell({ dark = false }: { dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationOut[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const loadUnread = async () => {
    try {
      const res = await api.notifications.unreadCount();
      setUnread(res.count);
    } catch {
      // silent - notification count is a non-critical enhancement
    }
  };

  useEffect(() => {
    loadUnread();
    const interval = setInterval(loadUnread, 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      try {
        setItems(await api.notifications.list());
      } catch (err) {
        setItems([]);
        if (!(err instanceof ApiError)) throw err;
      } finally {
        setLoading(false);
      }
    }
  };

  const markAllRead = async () => {
    try {
      await api.notifications.readAll();
      setUnread(0);
      setItems((prev) => (prev ? prev.map((n) => ({ ...n, is_read: true })) : prev));
    } catch {
      // best-effort
    }
  };

  const markOneRead = async (id: number) => {
    setItems((prev) => (prev ? prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)) : prev));
    setUnread((u) => Math.max(0, u - 1));
    try {
      await api.notifications.markRead(id);
    } catch {
      // best-effort
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        aria-label="Notifications"
        className={`relative w-9 h-9 flex items-center justify-center rounded-full transition-colors ${
          dark ? "text-paper-100 hover:bg-white/10" : "text-ink-700 hover:bg-paper-200"
        }`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path
            d="M6 10a6 6 0 1 1 12 0c0 3.2 1 5 2 6H4c1-1 2-2.8 2-6Z"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M10 20a2 2 0 0 0 4 0" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-seal-coral-600 text-white text-[10px] flex items-center justify-center font-medium">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-surface border border-line rounded-[var(--radius-card)] shadow-[var(--shadow-raised)] z-30">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line sticky top-0 bg-surface">
            <span className="text-sm font-medium text-ink-900">Notifications</span>
            {items && items.some((n) => !n.is_read) && (
              <button onClick={markAllRead} className="text-xs text-violet-600 font-medium hover:underline">
                Mark all read
              </button>
            )}
          </div>

          {loading && (
            <div className="flex justify-center py-8 text-ink-400">
              <Spinner />
            </div>
          )}

          {!loading && items && items.length === 0 && (
            <p className="text-sm text-ink-400 text-center py-8 px-4">
              You're all caught up - nothing new right now.
            </p>
          )}

          {!loading &&
            items?.map((n) => (
              <button
                key={n.id}
                onClick={() => !n.is_read && markOneRead(n.id)}
                className={`w-full text-left px-4 py-3 border-b border-line last:border-0 hover:bg-paper-100 transition-colors ${
                  n.is_read ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className="w-6 h-6 shrink-0 rounded-full bg-violet-50 text-violet-600 flex items-center justify-center text-xs"
                    aria-hidden="true"
                  >
                    {CATEGORY_ICON[n.category] ?? "•"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-900 leading-snug">{n.title}</p>
                    <p className="text-xs text-ink-500 mt-0.5 leading-snug">{n.body}</p>
                    <p className="text-[11px] text-ink-400 mt-1" style={{ fontFamily: "var(--font-mono)" }}>
                      {new Date(n.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </p>
                  </div>
                  {!n.is_read && <span className="w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0 mt-1.5" />}
                </div>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
