import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/lib/authStore";
import { listenToServiceWorker, rebindExistingSubscription } from "@/lib/pushClient";
import { setNotificationNavigator, useNotificationStore } from "@/lib/notificationStore";

/**
 * Keeps the unread count fresh for signed-in students and faculty: one poll
 * every 60s while the tab is visible (no sockets). Web Push, when enabled, is an additional channel. Admins publish
 * notifications rather than receive them, so they are never polled.
 */
export function NotificationPoller() {
  const { isAuthenticated, role } = useAuthStore();
  const navigate = useNavigate();
  const start = useNotificationStore((s) => s.start);
  const stop = useNotificationStore((s) => s.stop);

  useEffect(() => {
    if (!isAuthenticated || role === "admin" || !role) return;
    setNotificationNavigator(navigate);
    start();
    // Background push is an extra channel: re-attach an existing browser
    // subscription to this user (never prompts), and refresh the badge when a
    // push lands or its notification is clicked. Polling stays the baseline.
    void rebindExistingSubscription();
    const unlisten = listenToServiceWorker({
      onPush: () => void useNotificationStore.getState().refresh(),
      onNavigate: (path) => navigate(path),
    });
    return () => {
      unlisten();
      stop();
      setNotificationNavigator(null);
    };
  }, [isAuthenticated, role, navigate, start, stop]);

  return null;
}
