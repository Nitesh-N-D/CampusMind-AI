import { create } from "zustand";
import { api, type NotificationOut } from "./api";

const POLL_MS = 60_000;
const SEEN_KEY = "cm_alerted";
const SEEN_LIMIT = 200;

export type BrowserPermission = "unsupported" | "default" | "granted" | "denied";

function currentPermission(): BrowserPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

// Alerts already raised, so a notification is shown once per activity
// (publish or reminder), not on every poll or page reload.
function loadSeen(): string[] {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSeen(keys: string[]) {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(keys.slice(-SEEN_LIMIT)));
  } catch {
    // storage unavailable: dedupe still works for this page's lifetime
  }
}

const alertKey = (n: NotificationOut) => `${n.id}:${n.activity_at}`;

interface NotificationState {
  unread: number;
  latest: NotificationOut[];
  permission: BrowserPermission;
  /** Bumped on every successful poll so open pages know to refetch. */
  version: number;
  refresh: () => Promise<void>;
  start: () => void;
  stop: () => void;
  enableBrowserAlerts: () => Promise<BrowserPermission>;
  /** Local bookkeeping after the user reads items on the Notifications page. */
  setUnread: (unread: number) => void;
}

let timer: number | undefined;
let tick: (() => void) | null = null;
let seeded = false;
let seen: string[] = [];
let navigate: ((path: string) => void) | null = null;

export function setNotificationNavigator(fn: ((path: string) => void) | null) {
  navigate = fn;
}

function raiseBrowserAlerts(items: NotificationOut[]) {
  if (currentPermission() !== "granted") return;
  for (const n of items) {
    const key = alertKey(n);
    if (seen.includes(key)) continue;
    seen.push(key);
    try {
      const alert = new Notification(n.title, { body: n.body.slice(0, 140), tag: `cm-${n.id}` });
      alert.onclick = () => {
        window.focus();
        navigate?.("/notifications");
        alert.close();
      };
    } catch {
      // Some browsers (e.g. mobile Chrome) forbid the constructor; the
      // in-app bell still works.
    }
  }
  saveSeen(seen);
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  unread: 0,
  latest: [],
  permission: currentPermission(),
  version: 0,

  refresh: async () => {
    try {
      const { unread, latest } = await api.notifications.unread();
      if (!seeded) {
        // First poll of a session: show the badge but don't fire a burst of
        // alerts for things that were already waiting.
        seen = Array.from(new Set([...loadSeen(), ...latest.map(alertKey)]));
        saveSeen(seen);
        seeded = true;
      } else {
        raiseBrowserAlerts(latest);
      }
      set((s) => ({ unread, latest, version: s.version + 1, permission: currentPermission() }));
    } catch {
      // Transient (cold-starting server, offline): keep the last known state
      // and try again on the next tick.
    }
  },

  start: () => {
    if (timer !== undefined) return;
    seen = loadSeen();
    seeded = false;
    tick = () => {
      if (document.visibilityState === "visible") void get().refresh();
    };
    tick();
    timer = window.setInterval(tick, POLL_MS);
    // Catch up immediately when the tab becomes visible again.
    document.addEventListener("visibilitychange", tick);
  },

  stop: () => {
    if (timer !== undefined) window.clearInterval(timer);
    if (tick) document.removeEventListener("visibilitychange", tick);
    timer = undefined;
    tick = null;
    seeded = false;
    set({ unread: 0, latest: [], version: 0 });
  },

  // Only ever called from a button click. A denied permission is never
  // requested again; the user has to change it in the browser's site settings.
  enableBrowserAlerts: async () => {
    if (currentPermission() !== "default") {
      set({ permission: currentPermission() });
      return currentPermission();
    }
    try {
      await Notification.requestPermission();
    } catch {
      // older Safari used a callback form; permission is re-read below
    }
    const permission = currentPermission();
    set({ permission });
    return permission;
  },

  setUnread: (unread) => set({ unread }),
}));
