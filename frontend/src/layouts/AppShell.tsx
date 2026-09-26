import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Wordmark } from "@/components/Brand";
import { UserMenu } from "@/components/UserMenu";
import { useAuthStore } from "@/lib/authStore";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const Icon = {
  chat: (
    <path d="M4 5h16v11H8l-4 4V5Z" strokeWidth="1.6" strokeLinejoin="round" />
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
  logins: (
    <>
      <path d="M10 4h9v16h-9" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 12h10M11 8.5 14.5 12 11 15.5" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" strokeWidth="1.6" />
      <path
        d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
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

interface NavSection {
  label: string;
  items: NavItem[];
}

// Admins manage the workspace, so they get a full navigation rail. Chat is
// only a verification tool for them, so it sits under its own "Verify" group.
const adminNav: NavSection[] = [
  {
    label: "Manage workspace",
    items: [
      { to: "/admin", label: "Knowledge health", icon: <NavIcon path={Icon.health} /> },
      { to: "/admin/documents", label: "Documents", icon: <NavIcon path={Icon.docs} /> },
      { to: "/admin/conflicts", label: "Conflicts", icon: <NavIcon path={Icon.conflict} /> },
      { to: "/admin/logins", label: "Login activity", icon: <NavIcon path={Icon.logins} /> },
      { to: "/admin/settings", label: "Settings", icon: <NavIcon path={Icon.settings} /> },
    ],
  },
  {
    label: "Verify",
    items: [{ to: "/chat", label: "Test a question", icon: <NavIcon path={Icon.chat} /> }],
  },
];

// Students and faculty only have the assistant and their profile, so they
// get two small header links instead of a sidebar - chat gets the screen.
const endUserNav: NavItem[] = [
  { to: "/chat", label: "Assistant", icon: <NavIcon path={Icon.chat} /> },
  { to: "/profile", label: "Profile", icon: <NavIcon path={Icon.profile} /> },
];

/**
 * Layout for every signed-in page. The header (with the account menu on the
 * right) is identical everywhere; `fullBleed` pages such as chat fill the
 * space below it instead of sitting in a centered, padded column.
 */
export function AppShell({ children, fullBleed = false }: { children: ReactNode; fullBleed?: boolean }) {
  const { role, collegeName } = useAuthStore();
  const isAdmin = role === "admin";
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => setDrawerOpen(false), [location.pathname]);

  return (
    <div className={`bg-paper-100 flex ${fullBleed ? "h-dvh overflow-hidden" : "min-h-dvh"}`}>
      {isAdmin && (
        <>
          <aside
            aria-label="Workspace navigation"
            className={`fixed md:sticky top-0 left-0 z-40 h-dvh w-64 shrink-0 bg-navy-900 text-on-navy flex flex-col transition-transform duration-200 ${
              drawerOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
            }`}
          >
            <div className="h-14 flex items-center justify-between px-5 border-b border-white/10 shrink-0">
              <Link to="/admin" aria-label="Knowledge health">
                <Wordmark dark />
              </Link>
              <button
                aria-label="Close menu"
                onClick={() => setDrawerOpen(false)}
                className="md:hidden w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="px-5 py-4 border-b border-white/10">
              <p className="text-[11px] uppercase tracking-wider text-on-navy-muted/70">Workspace</p>
              <p className="font-medium text-sm mt-0.5 truncate">{collegeName}</p>
            </div>

            <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
              {adminNav.map((section) => (
                <div key={section.label}>
                  <p className="px-3 mb-1.5 text-[11px] uppercase tracking-wider text-on-navy-muted/70">
                    {section.label}
                  </p>
                  <div className="space-y-1">
                    {section.items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end
                        className={({ isActive }) =>
                          `flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-control)] text-sm transition-colors ${
                            isActive
                              ? "bg-white/10 text-white font-medium"
                              : "text-on-navy-muted hover:bg-white/5 hover:text-white"
                          }`
                        }
                      >
                        {item.icon}
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
          </aside>

          {drawerOpen && (
            <button
              aria-label="Close menu"
              className="fixed inset-0 bg-black/40 z-30 md:hidden"
              onClick={() => setDrawerOpen(false)}
            />
          )}
        </>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 h-14 shrink-0 bg-surface/90 backdrop-blur border-b border-line flex items-center gap-2 sm:gap-4 px-3 sm:px-5">
          {isAdmin ? (
            <>
              <button
                aria-label="Open menu"
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen(true)}
                className="md:hidden w-9 h-9 flex items-center justify-center rounded-[var(--radius-control)] text-ink-700 hover:bg-surface-hover"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                  <path d="M4 7h16M4 12h16M4 17h16" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
              <Link to="/admin" className="md:hidden" aria-label="Knowledge health">
                <Wordmark className="text-base" />
              </Link>
            </>
          ) : (
            <>
              <Link to="/chat" aria-label="CampusMind AI assistant" className="shrink-0">
                <Wordmark className="text-base" />
              </Link>
              {collegeName && (
                <span className="hidden lg:block text-xs text-ink-500 truncate border-l border-line pl-4 max-w-[16rem]">
                  {collegeName}
                </span>
              )}
              <nav aria-label="Main" className="flex items-center gap-1 ml-auto">
                {endUserNav.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end
                    aria-label={item.label}
                    className={({ isActive }) =>
                      `flex items-center gap-2 h-9 px-2.5 sm:px-3 rounded-[var(--radius-control)] text-sm transition-colors ${
                        isActive
                          ? "bg-violet-50 text-violet-600 font-medium"
                          : "text-ink-500 hover:text-ink-900 hover:bg-surface-hover"
                      }`
                    }
                  >
                    {item.icon}
                    <span className="hidden sm:inline">{item.label}</span>
                  </NavLink>
                ))}
              </nav>
            </>
          )}
          <div className={isAdmin ? "ml-auto" : "border-l border-line pl-2 sm:pl-3"}>
            <UserMenu />
          </div>
        </header>

        {fullBleed ? (
          <main className="flex-1 min-h-0">{children}</main>
        ) : (
          <main className="flex-1">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 py-6 sm:py-8">{children}</div>
          </main>
        )}
      </div>
    </div>
  );
}
