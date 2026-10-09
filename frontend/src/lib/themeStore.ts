import { create } from "zustand";

/** What the user chose. "system" follows the OS and tracks live changes. */
export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "cm_theme";
const QUERY = "(prefers-color-scheme: dark)";

function systemPrefersDark(): boolean {
  return window.matchMedia?.(QUERY).matches ?? false;
}

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Storage blocked (private mode): fall through to the default.
  }
  return "system";
}

function resolve(theme: Theme): "light" | "dark" {
  return theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = resolve(theme);
}

interface ThemeState {
  theme: Theme;
  /** The theme actually showing (system resolved to light or dark). */
  resolved: "light" | "dark";
  hydrate: () => void;
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
    set({ theme, resolved: resolve(theme) });
  };

  return {
    theme: readTheme(),
    resolved: resolve(readTheme()),

    hydrate: () => {
      const theme = readTheme();
      applyTheme(theme);
      set({ theme, resolved: resolve(theme) });
      // Follow the OS while "system" is selected.
      window.matchMedia?.(QUERY).addEventListener("change", () => {
        if (get().theme !== "system") return;
        applyTheme("system");
        set({ resolved: resolve("system") });
      });
    },

    setTheme: commit,
  };
});
