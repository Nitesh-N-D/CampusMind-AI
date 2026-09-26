import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useEffect } from "react";
import { useAuthStore } from "@/lib/authStore";
import { useThemeStore } from "@/lib/themeStore";
import { RequireAuth, RedirectIfAuthed } from "@/components/RouteGuards";
import { ToastContainer } from "@/components/ToastContainer";

import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import RegisterCollege from "@/pages/RegisterCollege";
import RegisterStudent from "@/pages/RegisterStudent";
import Chat from "@/pages/Chat";
import Profile from "@/pages/Profile";
import AdminDashboard from "@/pages/AdminDashboard";
import AdminConflicts from "@/pages/AdminConflicts";
import AdminDocuments from "@/pages/AdminDocuments";
import AdminLogins from "@/pages/AdminLogins";
import AdminSettings from "@/pages/AdminSettings";
import Privacy from "@/pages/Privacy";
import Terms from "@/pages/Terms";
import NotFound from "@/pages/NotFound";

export default function App() {
  const hydrate = useAuthStore((s) => s.hydrate);
  const hydrateTheme = useThemeStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
    hydrateTheme();
  }, [hydrate, hydrateTheme]);

  return (
    <BrowserRouter>
      <ToastContainer />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route
          path="/login"
          element={
            <RedirectIfAuthed>
              <Login />
            </RedirectIfAuthed>
          }
        />
        <Route
          path="/register"
          element={
            <RedirectIfAuthed>
              <RegisterStudent />
            </RedirectIfAuthed>
          }
        />
        <Route
          path="/register-college"
          element={
            <RedirectIfAuthed>
              <RegisterCollege />
            </RedirectIfAuthed>
          }
        />

        <Route
          path="/chat"
          element={
            <RequireAuth>
              <Chat />
            </RequireAuth>
          }
        />
        <Route
          path="/profile"
          element={
            <RequireAuth>
              <Profile />
            </RequireAuth>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAuth role="admin">
              <AdminDashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/documents"
          element={
            <RequireAuth role="admin">
              <AdminDocuments />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/conflicts"
          element={
            <RequireAuth role="admin">
              <AdminConflicts />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/logins"
          element={
            <RequireAuth role="admin">
              <AdminLogins />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/settings"
          element={
            <RequireAuth role="admin">
              <AdminSettings />
            </RequireAuth>
          }
        />

        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
