import { create } from "zustand";

export type Theme = "light" | "dark";

const STORAGE_KEY = "cm_theme";
const QUERY = "(prefers-color-scheme: dark)";

function systemPrefersDark(): boolean {
  return window.matchMedia?.(QUERY).matches ?? false;
}

/**
 * The saved choice, or the OS setting on a first visit. The OS setting is only
 * a starting point: once the user picks a theme it stays until they change it.
 * (An old saved "system" value is treated as unset.)
 */
function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage blocked (private mode): fall through to the OS setting.
  }
  return systemPrefersDark() ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

interface ThemeState {
  theme: Theme;
  hydrate: () => void;
  /** Quick flip between light and dark. */
  toggle: () => void;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const commit = (theme: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Not persisted, still applied for this session.
    }
    applyTheme(theme);
    set({ theme });
  };

  return {
    theme: readTheme(),

    hydrate: () => {
      const theme = readTheme();
      applyTheme(theme);
      set({ theme });
    },

    setTheme: commit,
    toggle: () => commit(get().theme === "dark" ? "light" : "dark"),
  };
});
