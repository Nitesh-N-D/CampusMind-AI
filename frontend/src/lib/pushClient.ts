import { api } from "./api";

/**
 * Background (Web Push) notifications. Separate from the in-page alerts in
 * notificationStore: this works with the tab closed, needs a service worker,
 * and is only ever started from an explicit button click.
 */
export type PushSupport = "unsupported" | "supported";

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return ok && window.isSecureContext ? "supported" : "unsupported";
}

function toKey(base64Url: string): Uint8Array {
  const pad = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob((base64Url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** The browser's subscription for the server's current VAPID key. A
 * subscription made under a different (rotated) key can never receive
 * pushes, so it is replaced rather than reused. */
async function subscriptionFor(reg: ServiceWorkerRegistration, publicKey: string): Promise<PushSubscription> {
  const wanted = toKey(publicKey);
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    const have = existing.options.applicationServerKey;
    const same = have !== null && new Uint8Array(have).join(",") === wanted.join(",");
    if (same) return existing;
    await existing.unsubscribe();
  }
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted as BufferSource });
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  return existing ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "supported") return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

function payloadOf(sub: PushSubscription) {
  const json = sub.toJSON();
  return { endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" } };
}

export type EnableResult = "enabled" | "denied" | "unsupported" | "not-configured" | "failed";

/** Call from a click handler only. Never re-prompts after a denial. */
export async function enableBackgroundNotifications(): Promise<EnableResult> {
  if (pushSupport() !== "supported") return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const status = await api.push.status();
    if (!status.configured || !status.public_key) return "not-configured";
    if (Notification.permission === "default") {
      const result = await Notification.requestPermission();
      if (result !== "granted") return result === "denied" ? "denied" : "failed";
    }
    const reg = await registration();
    await navigator.serviceWorker.ready;
    const sub = await subscriptionFor(reg, status.public_key);
    await api.push.subscribe(payloadOf(sub));
    return "enabled";
  } catch {
    return "failed";
  }
}

export async function disableBackgroundNotifications(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  try {
    await api.push.unsubscribe(sub.endpoint);
  } finally {
    await sub.unsubscribe();
  }
}

/** True when this browser has a push subscription the server knows about. */
export async function isSubscribedHere(): Promise<boolean> {
  return (await currentSubscription()) !== null;
}

/**
 * On sign-in, re-register an existing browser subscription for the current
 * user (a shared device then follows whoever is signed in). Never prompts.
 */
export async function rebindExistingSubscription(): Promise<void> {
  try {
    if (pushSupport() !== "supported" || Notification.permission !== "granted") return;
    if (!(await currentSubscription())) return;
    const status = await api.push.status();
    if (!status.configured || !status.public_key) return;
    const reg = await navigator.serviceWorker.ready;
    await api.push.subscribe(payloadOf(await subscriptionFor(reg, status.public_key)));
  } catch {
    // Best effort: in-app notifications are unaffected.
  }
}

/**
 * On sign-out, stop the server pushing this person's notifications to this
 * browser. The browser's own subscription and permission are kept, so the next
 * sign-in on this device (rebindExistingSubscription) attaches it to whoever
 * signs in. Must run before the session token is cleared.
 */
export async function detachThisDevice(): Promise<void> {
  try {
    const sub = await currentSubscription();
    if (sub) await api.push.unsubscribe(sub.endpoint);
  } catch {
    // Offline or already signed out: nothing more to do.
  }
}

/** Forward messages from the service worker (push arrived / notification clicked). */
export function listenToServiceWorker(handlers: {
  onPush: () => void;
  onNavigate: (path: string) => void;
}): () => void {
  if (pushSupport() !== "supported") return () => undefined;
  const listener = (event: MessageEvent) => {
    const data = event.data as { type?: string; path?: string } | null;
    if (!data) return;
    if (data.type === "cm-push") handlers.onPush();
    else if (data.type === "cm-navigate" && data.path === "/notifications") handlers.onNavigate(data.path);
    else if (data.type === "cm-navigate" && data.path === "/reminders") handlers.onNavigate(data.path);
  };
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}
