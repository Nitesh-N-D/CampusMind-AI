import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useNavigate, Link } from "react-router-dom";
import { Wordmark } from "@/components/Brand";
import { NotificationBell } from "@/components/NotificationBell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuthStore } from "@/lib/authStore";
import { useCommandPaletteStore } from "@/lib/commandPaletteStore";
import { api } from "@/lib/api";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const Icon = {
  chat: (
    <path d="M4 5h16v11H8l-4 4V5Z" strokeWidth="1.6" strokeLinejoin="round" />
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" strokeWidth="1.6" />
      <path d="m20 20-4.3-4.3" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  timeline: (
    <>
      <path d="M4 6h16M4 12h16M4 18h10" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="19" cy="18" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  docs: (
    <path
      d="M7 3h7l5 5v13H7V3Z M14 3v5h5"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="3.4" strokeWidth="1.6" />
      <path d="M5 20c1.2-4 4-6 7-6s5.8 2 7 6" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  health: (
    <path
      d="M4 12h4l2-6 4 12 2-6h4"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  conflict: (
    <>
      <path d="M12 3 3 20h18L12 3Z" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 9.5v4.5M12 17h.01" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  changed: (
    <>
      <path d="M4 7h11l-3-3M20 17H9l3 3" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  logout: (
    <>
      <path d="M9 4H5v16h4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 8l4 4-4 4M19 12H9" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
};

function NavIcon({ path }: { path: ReactNode }) {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      {path}
    </svg>
  );
}

const studentNav: NavItem[] = [
  { to: "/chat", label: "Ask CampusMind", icon: <NavIcon path={Icon.chat} /> },
  { to: "/search", label: "Search", icon: <NavIcon path={Icon.search} /> },
  { to: "/timeline", label: "Timeline", icon: <NavIcon path={Icon.timeline} /> },
  { to: "/what-changed", label: "What changed?", icon: <NavIcon path={Icon.changed} /> },
  { to: "/documents", label: "Documents", icon: <NavIcon path={Icon.docs} /> },
  { to: "/profile", label: "Profile", icon: <NavIcon path={Icon.profile} /> },
];

const adminNav: NavItem[] = [
  { to: "/chat", label: "Ask CampusMind", icon: <NavIcon path={Icon.chat} /> },
  { to: "/search", label: "Search", icon: <NavIcon path={Icon.search} /> },
  { to: "/timeline", label: "Timeline", icon: <NavIcon path={Icon.timeline} /> },
  { to: "/what-changed", label: "What changed?", icon: <NavIcon path={Icon.changed} /> },
  { to: "/documents", label: "Documents", icon: <NavIcon path={Icon.docs} /> },
  { to: "/admin", label: "Knowledge health", icon: <NavIcon path={Icon.health} /> },
  { to: "/admin/conflicts", label: "Conflicts", icon: <NavIcon path={Icon.conflict} /> },
  { to: "/profile", label: "Profile", icon: <NavIcon path={Icon.profile} /> },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { role, fullName, collegeName, logout } = useAuthStore();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [nickname, setNickname] = useState<string | null>(null);
  const items = role === "admin" ? adminNav : studentNav;

  useEffect(() => {
    api.profile
      .me()
      .then((p) => {
        setNickname(p.nickname);
      })
      .catch(() => {
        // Non-fatal - the sidebar falls back to the name from login.
      });
  }, []);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-paper-100 flex">
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 h-14 bg-surface border-b border-line flex items-center justify-between px-4 z-30">
        <Wordmark className="text-base" />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <NotificationBell />
          <button
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileOpen((v) => !v)}
            className="w-9 h-9 flex items-center justify-center rounded-[var(--radius-control)] border border-line-strong"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              {mobileOpen ? (
                <path d="M6 6l12 12M18 6 6 18" strokeWidth="1.8" strokeLinecap="round" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" strokeWidth="1.8" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Sidebar */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-20 w-64 bg-navy-900 text-paper-100 flex flex-col transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="h-14 md:h-16 flex items-center justify-between px-5 border-b border-white/10 mt-14 md:mt-0">
          <Wordmark dark />
          <div className="flex items-center gap-0.5">
            <ThemeToggle dark />
            <NotificationBell dark />
          </div>
        </div>

        <div className="px-5 py-4 border-b border-white/10">
          <p className="text-xs uppercase tracking-wider text-paper-300/70">Workspace</p>
          <p className="font-medium text-sm mt-0.5 truncate">{collegeName}</p>
          <Link to="/profile" className="flex items-center gap-2.5 mt-3 group">
            <span className="min-w-0">
              <span className="text-sm truncate block group-hover:underline">{nickname || fullName}</span>
              <span className="inline-block text-[11px] px-1.5 py-0.5 rounded bg-white/10 uppercase tracking-wide">
                {role}
              </span>
            </span>
          </Link>
        </div>

        <div className="px-3 pt-3">
          <button
            onClick={() => useCommandPaletteStore.getState().setOpen(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-control)] border border-white/10 text-paper-300 text-sm hover:bg-white/5 hover:text-white transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" strokeWidth="1.6" />
              <path d="m20 20-4.3-4.3" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            Quick jump
            <kbd className="ml-auto text-[10px] border border-white/15 rounded px-1.5 py-0.5">⌘K</kbd>
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-control)] text-sm transition-colors ${
                  isActive ? "bg-white/10 text-white font-medium" : "text-paper-300 hover:bg-white/5 hover:text-white"
                }`
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-white/10">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-control)] text-sm text-paper-300 hover:bg-white/5 hover:text-white transition-colors"
          >
            <NavIcon path={Icon.logout} />
            Sign out
          </button>
        </div>
      </aside>

      {mobileOpen && (
        <button
          aria-label="Close menu"
          className="fixed inset-0 bg-black/30 z-10 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <main className="flex-1 min-w-0 pt-14 md:pt-0">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 py-8">{children}</div>
      </main>
    </div>
  );
}
