import { create } from "zustand";

export type Theme = "light" | "dark";
const STORAGE_KEY = "cm_theme";

function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

interface ThemeState {
  theme: Theme;
  hydrate: () => void;
  toggle: () => void;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: "light",

  hydrate: () => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    const theme = stored ?? (systemPrefersDark() ? "dark" : "light");
    applyTheme(theme);
    set({ theme });
  },

  setTheme: (theme) => {
    localStorage.setItem(STORAGE_KEY, theme);
    applyTheme(theme);
    set({ theme });
  },

  toggle: () => {
    const next: Theme = get().theme === "light" ? "dark" : "light";
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    set({ theme: next });
  },
}));
