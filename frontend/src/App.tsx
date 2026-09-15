import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useEffect } from "react";
import { useAuthStore } from "@/lib/authStore";
import { useThemeStore } from "@/lib/themeStore";
import { RequireAuth, RedirectIfAuthed } from "@/components/RouteGuards";
import { ToastContainer } from "@/components/ToastContainer";
import { CommandPalette } from "@/components/CommandPalette";

import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import RegisterCollege from "@/pages/RegisterCollege";
import RegisterStudent from "@/pages/RegisterStudent";
import Chat from "@/pages/Chat";
import SearchPage from "@/pages/Search";
import Timeline from "@/pages/Timeline";
import Documents from "@/pages/Documents";
import WhatChanged from "@/pages/WhatChanged";
import Profile from "@/pages/Profile";
import AdminDashboard from "@/pages/AdminDashboard";
import AdminConflicts from "@/pages/AdminConflicts";
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
      <CommandPalette />
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
          path="/search"
          element={
            <RequireAuth>
              <SearchPage />
            </RequireAuth>
          }
        />
        <Route
          path="/timeline"
          element={
            <RequireAuth>
              <Timeline />
            </RequireAuth>
          }
        />
        <Route
          path="/documents"
          element={
            <RequireAuth>
              <Documents />
            </RequireAuth>
          }
        />
        <Route
          path="/what-changed"
          element={
            <RequireAuth>
              <WhatChanged />
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
          path="/admin/conflicts"
          element={
            <RequireAuth role="admin">
              <AdminConflicts />
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
