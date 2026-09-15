import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "@/lib/authStore";

export function RequireAuth({ children, role }: { children: ReactNode; role?: "admin" | "student" | "faculty" }) {
  const { isAuthenticated, role: userRole } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (role && userRole !== role) {
    return <Navigate to={userRole === "admin" ? "/admin" : "/chat"} replace />;
  }
  return <>{children}</>;
}

export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { isAuthenticated, role } = useAuthStore();
  if (isAuthenticated) return <Navigate to={role === "admin" ? "/admin" : "/chat"} replace />;
  return <>{children}</>;
}
