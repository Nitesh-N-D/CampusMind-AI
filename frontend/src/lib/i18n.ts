import { create } from "zustand";
import { en, type MessageKey } from "@/locales/en";
import { ta } from "@/locales/ta";
import { hi } from "@/locales/hi";

export type { MessageKey };

/**
 * Add a language by adding one dictionary in src/locales and one row here.
 * Missing keys fall back to English, so a partial translation never breaks
 * the UI. `code` matches the language codes the backend accepts for answers.
 */
export const LANGUAGES = [
  { code: "en", label: "English", messages: en as Record<MessageKey, string> },
  { code: "ta", label: "தமிழ்", messages: ta as Partial<Record<MessageKey, string>> },
  { code: "hi", label: "हिन्दी", messages: hi as Partial<Record<MessageKey, string>> },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

const STORAGE_KEY = "cm_lang";

function isSupported(code: string | null | undefined): code is LanguageCode {
  return LANGUAGES.some((l) => l.code === code);
}

function initialLanguage(): LanguageCode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isSupported(stored)) return stored;
  } catch {
    // Storage blocked: use the browser language below.
  }
  const browser = navigator.language?.slice(0, 2);
  return isSupported(browser) ? browser : "en";
}

interface LanguageState {
  language: LanguageCode;
  setLanguage: (code: LanguageCode) => void;
}

const initial = initialLanguage();
document.documentElement.lang = initial;

export const useLanguageStore = create<LanguageState>((set) => ({
  language: initial,
  setLanguage: (code) => {
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // Applies for this session only.
    }
    document.documentElement.lang = code;
    set({ language: code });
  },
}));

type Vars = Record<string, string | number>;

export function translate(language: LanguageCode, key: MessageKey, vars?: Vars): string {
  const messages = LANGUAGES.find((l) => l.code === language)?.messages;
  const template = messages?.[key] ?? en[key];
  return vars ? template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`)) : template;
}

/** `const t = useT(); t("chat.send")` - re-renders when the language changes. */
export function useT() {
  const language = useLanguageStore((s) => s.language);
  return (key: MessageKey, vars?: Vars) => translate(language, key, vars);
}
