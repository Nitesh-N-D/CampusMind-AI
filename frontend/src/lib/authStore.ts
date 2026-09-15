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

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  role: null,
  collegeId: null,
  collegeName: null,
  fullName: null,
  isAuthenticated: false,

  hydrate: () => {
    const token = localStorage.getItem(STORAGE_KEYS.token);
    const role = localStorage.getItem(STORAGE_KEYS.role) as "admin" | "student" | "faculty" | null;
    const collegeId = localStorage.getItem(STORAGE_KEYS.collegeId);
    const collegeName = localStorage.getItem(STORAGE_KEYS.collegeName);
    const fullName = localStorage.getItem(STORAGE_KEYS.fullName);
    if (token && role) {
      set({
        token,
        role,
        collegeId: collegeId ? Number(collegeId) : null,
        collegeName,
        fullName,
        isAuthenticated: true,
      });
    }
  },

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
    set({
      token: null,
      role: null,
      collegeId: null,
      collegeName: null,
      fullName: null,
      isAuthenticated: false,
    });
  },
}));
