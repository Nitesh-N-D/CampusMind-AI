import { create } from "zustand";
import type { TokenResponse } from "./api";

interface AuthState {
  token: string | null;
  role: "admin" | "student" | "faculty" | null;
  collegeId: number | null;
  collegeName: string | null;
  fullName: string | null;
  isAuthenticated: boolean;
  hydrate: () => void;
  setSession: (session: TokenResponse) => void;
  logout: () => void;
}

const STORAGE_KEYS = {
  token: "cm_token",
  role: "cm_role",
  collegeId: "cm_college_id",
  collegeName: "cm_college_name",
  fullName: "cm_full_name",
} as const;

type SessionFields = Omit<AuthState, "hydrate" | "setSession" | "logout">;

const SIGNED_OUT: SessionFields = {
  token: null,
  role: null,
  collegeId: null,
  collegeName: null,
  fullName: null,
  isAuthenticated: false,
};

function readStoredSession(): SessionFields {
  const token = localStorage.getItem(STORAGE_KEYS.token);
  const role = localStorage.getItem(STORAGE_KEYS.role) as "admin" | "student" | "faculty" | null;
  if (!token || !role) return SIGNED_OUT;
  const collegeId = localStorage.getItem(STORAGE_KEYS.collegeId);
  return {
    token,
    role,
    collegeId: collegeId ? Number(collegeId) : null,
    collegeName: localStorage.getItem(STORAGE_KEYS.collegeName),
    fullName: localStorage.getItem(STORAGE_KEYS.fullName),
    isAuthenticated: true,
  };
}

// The session is read synchronously at startup so route guards see it on
// the very first render - otherwise a refresh on a protected page would
// bounce through /login and lose the deep link.
export const useAuthStore = create<AuthState>((set) => ({
  ...readStoredSession(),

  hydrate: () => set(readStoredSession()),

  setSession: (session) => {
    localStorage.setItem(STORAGE_KEYS.token, session.access_token);
    localStorage.setItem(STORAGE_KEYS.role, session.role);
    localStorage.setItem(STORAGE_KEYS.collegeId, String(session.college_id));
    localStorage.setItem(STORAGE_KEYS.collegeName, session.college_name);
    localStorage.setItem(STORAGE_KEYS.fullName, session.full_name);
    set({
      token: session.access_token,
      role: session.role,
      collegeId: session.college_id,
      collegeName: session.college_name,
      fullName: session.full_name,
      isAuthenticated: true,
    });
  },

  logout: () => {
    Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
    set(SIGNED_OUT);
  },
}));
