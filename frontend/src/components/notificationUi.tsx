import { useEffect, useState } from "react";
import { api, ApiError, parseUtc, type NotificationCategory, type NotificationOut } from "@/lib/api";
import { toastError } from "@/lib/toastStore";
import { useNotificationStore } from "@/lib/notificationStore";
import {
  disableBackgroundNotifications,
  enableBackgroundNotifications,
  isSubscribedHere,
  pushSupport,
} from "@/lib/pushClient";
import { Badge, Button } from "@/components/ui";
import { useNavigate } from "react-router-dom";
import { useT } from "@/lib/i18n";

/** Opens the assistant with a prefilled question about a notice. The student
 * can edit it before sending; nothing is submitted automatically. */
export function AskCampusMindButton({ title }: { title: string }) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <Button
      variant="secondary"
      className="!py-1.5 !px-3"
      title={t("notif.askAiHint")}
      onClick={() => navigate(`/chat?ask=${encodeURIComponent(t("notif.askPrompt", { title }))}`)}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
        <path d="M4 5h16v11H8l-4 4V5Z" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
      {t("notif.askAi")}
    </Button>
  );
}

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  circular: "Circular",
  announcement: "Announcement",
  holiday: "Holiday",
  deadline: "Deadline",
  examination: "Examination",
  assignment: "Assignment",
  event: "Event",
  academic: "Academic",
  general: "General",
};

/** Category is a plain label: kind of notice is information, not an alarm. Colour is
 * reserved for urgency (priority and due date), which are the things that need action. */
export function CategoryBadge({ category }: { category: NotificationCategory }) {
  return <Badge tone="neutral">{CATEGORY_LABELS[category] ?? category}</Badge>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  if (priority === "urgent") return <Badge tone="coral">Urgent</Badge>;
  if (priority === "important") return <Badge tone="amber">Important</Badge>;
  return null;
}

export function formatWhen(value: string, withTime = true): string {
  return parseUtc(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

/** Whole calendar days from today (local) to the date; negative once passed. */
export function daysUntil(value: string): number {
  const target = parseUtc(value);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOf(target) - startOf(new Date())) / 86_400_000);
}

export function dueLabel(n: NotificationOut): { text: string; tone: "coral" | "amber" | "neutral" } | null {
  const date = n.deadline ?? n.event_date;
  if (!date) return null;
  const d = daysUntil(date);
  const prefix = n.deadline ? "Due" : "On";
  if (d < 0) return { text: `${prefix} ${formatWhen(date, false)} (passed)`, tone: "neutral" };
  if (d === 0) return { text: `${prefix} today`, tone: "coral" };
  if (d === 1) return { text: `${prefix} tomorrow`, tone: "coral" };
  if (d <= 7) return { text: `${prefix} in ${d} days`, tone: "amber" };
  return { text: `${prefix} ${formatWhen(date, false)}`, tone: "neutral" };
}

export function DueBadge({ n }: { n: NotificationOut }) {
  const due = dueLabel(n);
  return due ? <Badge tone={due.tone}>{due.text}</Badge> : null;
}

export function AttachmentButtons({ n }: { n: NotificationOut }) {
  const [busy, setBusy] = useState(false);
  if (!n.attachment) return null;
  const { document_id, filename } = n.attachment;
  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : "Couldn't open the attachment.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink-500 truncate max-w-[14rem]" title={filename}>
        {filename}
      </span>
      <Button variant="secondary" className="!py-1.5 !px-3" disabled={busy} onClick={run(() => api.documents.openFile(document_id, filename))}>
        View
      </Button>
      <Button variant="ghost" className="!py-1.5 !px-3" disabled={busy} onClick={run(() => api.documents.downloadFile(document_id, filename))}>
        Download
      </Button>
    </div>
  );
}

/**
 * Explicit opt-in for browser alerts. Permission is only requested from this
 * button, never on load, and a denial is never re-requested. Without support
 * or permission the in-app bell and pages keep working as normal.
 */
export function BrowserAlertsControl() {
  const permission = useNotificationStore((s) => s.permission);
  const enable = useNotificationStore((s) => s.enableBrowserAlerts);

  if (permission === "unsupported") {
    return <p className="text-xs text-ink-500">Browser alerts aren't supported here; notifications appear in the app.</p>;
  }
  if (permission === "granted") {
    return <p className="text-xs text-seal-teal-900">Browser alerts are on while CampusMind is open.</p>;
  }
  if (permission === "denied") {
    return (
      <p className="text-xs text-ink-500">
        Browser alerts are blocked. To turn them on, allow notifications for this site in your browser settings.
        Notifications still appear in the app.
      </p>
    );
  }
  return (
    <Button variant="secondary" onClick={() => void enable()}>
      Enable Notifications
    </Button>
  );
}

/**
 * Background notifications (Web Push): delivered even when CampusMind is
 * closed. Always an explicit click; unsupported browsers and a missing server
 * configuration get a plain explanation, and in-app notifications are
 * unaffected either way.
 */
export function BackgroundNotificationsControl() {
  const [here, setHere] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const supported = pushSupport() === "supported";
  const denied = typeof Notification !== "undefined" && Notification.permission === "denied";

  useEffect(() => {
    if (supported) void isSubscribedHere().then(setHere);
  }, [supported]);

  if (!supported) {
    return (
      <p className="text-xs text-ink-500">
        Background notifications aren't supported in this browser (they need HTTPS and a browser with push support).
        You'll still get notifications in the app.
      </p>
    );
  }

  const turnOn = async () => {
    setBusy(true);
    setMessage(null);
    const result = await enableBackgroundNotifications();
    setHere(result === "enabled");
    setMessage(
      {
        enabled: null,
        denied: "Notifications are blocked for this site. Allow them in your browser settings to continue.",
        unsupported: "This browser can't receive background notifications.",
        "not-configured": "Background notifications aren't set up on this server yet.",
        failed: "Couldn't turn on background notifications. Please try again.",
      }[result]
    );
    setBusy(false);
  };

  const turnOff = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await disableBackgroundNotifications();
      setHere(false);
    } catch {
      setMessage("Couldn't turn off background notifications. Please try again.");
    }
    setBusy(false);
  };

  return (
    <div className="grid gap-1.5">
      {here ? (
        <>
          <p className="text-xs text-seal-teal-900">Background notifications are on for this device.</p>
          <div>
            <Button variant="secondary" onClick={() => void turnOff()} disabled={busy}>
              Turn off
            </Button>
          </div>
        </>
      ) : denied ? (
        <p className="text-xs text-ink-500">
          Background notifications are blocked. Allow notifications for this site in your browser settings.
        </p>
      ) : (
        <div>
          <Button variant="secondary" onClick={() => void turnOn()} disabled={busy}>
            Enable Background Notifications
          </Button>
        </div>
      )}
      {message && <p className="text-xs text-ink-500">{message}</p>}
    </div>
  );
}
