import { create } from "zustand";

export type Theme = "light" | "dark";
/** What the user picked. "system" follows the OS and updates live. */
export type ThemePreference = Theme | "system";

const STORAGE_KEY = "cm_theme";
const QUERY = "(prefers-color-scheme: dark)";

function systemPrefersDark(): boolean {
  return window.matchMedia?.(QUERY).matches ?? false;
}

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Storage blocked (private mode): fall through to following the system.
  }
  return "system";
}

function resolve(preference: ThemePreference): Theme {
  return preference === "system" ? (systemPrefersDark() ? "dark" : "light") : preference;
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

interface ThemeState {
  /** The theme actually showing right now. */
  theme: Theme;
  preference: ThemePreference;
  hydrate: () => void;
  /** Quick flip between light and dark (sets an explicit preference). */
  toggle: () => void;
  setPreference: (preference: ThemePreference) => void;
}

const initialPreference = readPreference();

export const useThemeStore = create<ThemeState>((set, get) => {
  const commit = (preference: ThemePreference) => {
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Not persisted, still applied for this session.
    }
    const theme = resolve(preference);
    applyTheme(theme);
    set({ preference, theme });
  };

  return {
    preference: initialPreference,
    theme: resolve(initialPreference),

    hydrate: () => {
      const preference = readPreference();
      const theme = resolve(preference);
      applyTheme(theme);
      set({ preference, theme });
      // Follow OS changes while the user is on "system".
      window.matchMedia?.(QUERY).addEventListener("change", () => {
        if (get().preference !== "system") return;
        const next = resolve("system");
        applyTheme(next);
        set({ theme: next });
      });
    },

    setPreference: commit,
    toggle: () => commit(get().theme === "dark" ? "light" : "dark"),
  };
});
