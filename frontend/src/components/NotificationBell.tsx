import { Link } from "react-router-dom";
import { useNotificationStore } from "@/lib/notificationStore";

export function NotificationBell() {
  const unread = useNotificationStore((s) => s.unread);
  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";
  return (
    <Link
      to="/notifications"
      aria-label={label}
      className="relative w-10 h-10 flex items-center justify-center rounded-[var(--radius-control)] text-ink-500 hover:text-ink-900 hover:bg-surface-hover"
    >
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
        <path
          d="M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15L6 17Z M10 21h4"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {unread > 0 && (
        <span className="absolute top-0.5 right-0.5 min-w-4 h-4 px-1 rounded-[var(--radius-chip)] bg-lamp text-on-lamp text-[10px] leading-4 font-bold text-center">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
