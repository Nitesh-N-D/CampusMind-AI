import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/layouts/AppShell";
import { DateStamp } from "@/components/campus";
import { Badge, Button, EmptyState, ErrorBanner, PageHeader, SkeletonList } from "@/components/ui";
import {
  AskCampusMindButton,
  AttachmentButtons,
  BackgroundNotificationsControl,
  BrowserAlertsControl,
  CategoryBadge,
  DueBadge,
  PriorityBadge,
  daysUntil,
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

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div role="tablist" aria-label="Filter notifications" className="flex border-b border-line-strong">
          {(["all", "unread", "read"] as Filter[]).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`min-h-11 px-4 text-sm capitalize transition-colors ${
                filter === f ? "lamp-under font-bold text-ink-950" : "text-ink-700 hover:text-ink-950"
              }`}
            >
              {f}
              {f === "unread" && unreadCount > 0 ? ` (${unreadCount})` : ""}
            </button>
          ))}
        </div>
        <div className="grid gap-3 max-w-md">
          <BrowserAlertsControl />
          <BackgroundNotificationsControl />
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {!error && items === null && <SkeletonList count={4} lines={2} />}

      {items && shown.length === 0 && (
        <EmptyState
          title={
            filter === "unread"
              ? "No unread notices. You're up to date."
              : filter === "read"
                ? "No read notices yet."
                : "No official notices have been published."
          }
          body="When your college publishes a circular, holiday or deadline, it will appear here. You can ask CampusMind about any notice."
          action={
            filter !== "all" && (items?.length ?? 0) > 0 ? (
              <Button variant="secondary" onClick={() => setFilter("all")}>
                Show all notifications
              </Button>
            ) : undefined
          }
        />
      )}

      {shown.length > 0 && (
        <ul className="border-t border-line-strong">
          {shown.map((n) => {
            const when = n.deadline ?? n.event_date;
            const d = when ? daysUntil(when) : null;
            const official = n.verified || n.category === "circular";
            return (
              <li
                key={n.id}
                className={`flex gap-4 py-5 pr-2 border-b border-line ${
                  n.is_read ? "pl-4" : "pl-3 border-l-[5px] border-l-lamp"
                } ${n.state === "expired" ? "opacity-70" : ""}`}
              >
                <DateStamp
                  date={when ?? n.activity_at}
                  state={d === null ? "later" : d < 0 ? "past" : d === 0 ? "today" : d <= 7 ? "soon" : "later"}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    {official && <Badge tone="violet">Official notice</Badge>}
                    {!n.is_read && <span className="label-caps !text-ink-950">New</span>}
                    <CategoryBadge category={n.category} />
                    <PriorityBadge priority={n.priority} />
                    <DueBadge n={n} />
                    {n.state === "expired" && <Badge>Expired</Badge>}
                  </div>
                  <h3
                    className={`mt-2 text-ink-950 leading-snug ${
                      official ? "text-xl" : "text-base"
                    } ${n.is_read ? "font-medium" : "font-bold"}`}
                  >
                    {n.title}
                  </h3>
                  <p className="text-sm text-ink-700 mt-1.5 whitespace-pre-line">{n.body}</p>
                  <p className="data text-ink-500 mt-2.5">
                    {n.circular_number ? `${n.circular_number} · ` : ""}
                    {n.department ? `${n.department} · ` : ""}
                    For {n.audience === "both" ? "students and faculty" : `${n.audience}s`} · {formatWhen(n.activity_at)}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <AttachmentButtons n={n} />
                    <div className="flex flex-wrap items-center gap-2">
                      <AskCampusMindButton title={n.title} />
                      {!n.is_read && (
                        <Button variant="ghost" className="!py-1.5 !px-3 border border-line-strong" onClick={() => markRead(n)}>
                          Mark as read
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
