import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/layouts/AppShell";
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, SkeletonList } from "@/components/ui";
import {
  AskCampusMindButton,
  AttachmentButtons,
  BackgroundNotificationsControl,
  BrowserAlertsControl,
  CategoryBadge,
  DueBadge,
  PriorityBadge,
  formatWhen,
} from "@/components/notificationUi";
import { api, ApiError, type NotificationOut } from "@/lib/api";
import { useNotificationStore } from "@/lib/notificationStore";
import { toastError } from "@/lib/toastStore";

type Filter = "all" | "unread" | "read";

export default function Notifications() {
  const [items, setItems] = useState<NotificationOut[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const version = useNotificationStore((s) => s.version);
  const refreshBell = useNotificationStore((s) => s.refresh);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await api.notifications.list());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load notifications.");
    }
  }, []);

  // Reload on mount and whenever the 60s poll finds something changed.
  useEffect(() => {
    void load();
  }, [load, version]);

  const markRead = async (n: NotificationOut) => {
    if (n.is_read) return;
    setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)) ?? prev);
    try {
      await api.notifications.markRead(n.id);
      void refreshBell();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : "Couldn't mark as read.");
      void load();
    }
  };

  const markAll = async () => {
    try {
      await api.notifications.markAllRead();
      setItems((prev) => prev?.map((x) => ({ ...x, is_read: true })) ?? prev);
      void refreshBell();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : "Couldn't mark all as read.");
    }
  };

  const unreadCount = items?.filter((n) => !n.is_read).length ?? 0;
  const shown = (items ?? []).filter((n) =>
    filter === "all" ? true : filter === "unread" ? !n.is_read : !!n.is_read
  );

  return (
    <AppShell>
      <PageHeader
        eyebrow="Inbox"
        title="Notifications"
        description="Official circulars, holidays, deadlines and announcements from your college."
        actions={
          <Button variant="secondary" onClick={markAll} disabled={unreadCount === 0}>
            Mark all as read
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Filter notifications" className="flex gap-1">
          {(["all", "unread", "read"] as Filter[]).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`h-9 px-3 rounded-[var(--radius-control)] text-sm capitalize transition-colors ${
                filter === f ? "bg-violet-50 text-violet-600 font-medium" : "text-ink-500 hover:bg-surface-hover"
              }`}
            >
              {f}
              {f === "unread" && unreadCount > 0 ? ` (${unreadCount})` : ""}
            </button>
          ))}
        </div>
        <div className="grid gap-3">
          <BrowserAlertsControl />
          <BackgroundNotificationsControl />
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {!error && items === null && <SkeletonList count={4} lines={2} />}

      {items && shown.length === 0 && (
        <EmptyState
          title={filter === "unread" ? "You're all caught up" : "No notifications yet"}
          body="When your college publishes a circular, holiday or deadline, it will show up here."
        />
      )}

      <div className="grid gap-3">
        {shown.map((n) => (
          <Card
            key={n.id}
            className={`p-5 ${n.is_read ? "" : "border-l-4 !border-l-violet-500"} ${
              n.state === "expired" ? "opacity-70" : ""
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className={`text-ink-900 ${n.is_read ? "font-normal" : "font-medium"}`}>{n.title}</h3>
              <CategoryBadge category={n.category} />
              <PriorityBadge priority={n.priority} />
              <DueBadge n={n} />
              {n.state === "expired" && <Badge>Expired</Badge>}
              {n.verified && <Badge tone="teal">Official</Badge>}
            </div>
            <p className="text-sm text-ink-700 mt-2 whitespace-pre-line">{n.body}</p>
            <p className="text-xs text-ink-400 mt-2">
              {n.circular_number ? `${n.circular_number} - ` : ""}
              {n.department ? `${n.department} - ` : ""}
              {formatWhen(n.activity_at)}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <AttachmentButtons n={n} />
              <div className="flex flex-wrap items-center gap-1">
                <AskCampusMindButton title={n.title} />
                {!n.is_read && (
                  <Button variant="ghost" className="!py-1.5 !px-3" onClick={() => markRead(n)}>
                    Mark as read
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
