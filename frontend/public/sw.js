/* CampusMind background notifications.
 * Holds no secrets and makes no API calls: the push payload is minimal and
 * everything else is fetched by the app after the user opens it. */
const FALLBACK_URL = "/notifications";
// Only these in-app routes may be opened from a notification.
const TRUSTED_ROUTES = ["/notifications", "/reminders"];

function parsePayload(event) {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  if (typeof data !== "object" || data === null) data = {};
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const id = Number.isInteger(data.notification_id) ? data.notification_id : null;
  const url = typeof data.url === "string" && TRUSTED_ROUTES.includes(data.url) ? data.url : FALLBACK_URL;
  return {
    id,
    url,
    title: str(data.title, 120) || "CampusMind",
    body: str(data.body, 140) || "You have a new notification.",
  };
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  const p = parsePayload(event);
  // Browsers require every push to show something. The same tag as the
  // in-page alert (cm-<id>) means a poll alert and a push for one
  // notification replace each other instead of stacking.
  const show = self.registration.showNotification(p.title, {
    body: p.body,
    icon: "/favicon.svg",
    tag: p.id !== null ? "cm-" + p.id : undefined,
    data: { url: p.url },
  });
  const tell = self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((list) => list.forEach((c) => c.postMessage({ type: "cm-push", id: p.id })));
  event.waitUntil(Promise.all([show, tell]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.url;
  const path = TRUSTED_ROUTES.includes(raw) ? raw : FALLBACK_URL;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && "focus" in c) {
          c.postMessage({ type: "cm-navigate", path });
          return c.focus();
        }
      }
      return self.clients.openWindow(path);
    })
  );
});
