import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { MarkIcon, Wordmark } from "@/components/Brand";
import { UserMenu } from "@/components/UserMenu";
import { NotificationBell } from "@/components/NotificationBell";
import { useAuthStore } from "@/lib/authStore";
import { useNotificationStore } from "@/lib/notificationStore";
import { useT } from "@/lib/i18n";
import { usePageMeta } from "@/lib/usePageMeta";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const Icon = {
  chat: <path d="M4 5h16v11H8l-4 4V5Z" strokeWidth="1.6" strokeLinejoin="round" />,
  docs: <path d="M7 3h7l5 5v13H7V3Z M14 3v5h5" strokeWidth="1.6" strokeLinejoin="round" />,
  profile: (
    <>
      <circle cx="12" cy="8" r="3.4" strokeWidth="1.6" />
      <path d="M5 20c1.2-4 4-6 7-6s5.8 2 7 6" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  health: <path d="M4 12h4l2-6 4 12 2-6h4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />,
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
  bell: (
    <path
      d="M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15L6 17Z M10 21h4"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" strokeWidth="1.6" />
      <path d="M4 10h16M9 3v4M15 3v4" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  insights: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" strokeWidth="1.6" strokeLinecap="round" />,
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
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" className="shrink-0">
      {path}
    </svg>
  );
}

interface NavSection {
  label: string;
  items: NavItem[];
}

// Admins manage the workspace. Chat is only a verification tool for them, so
// it sits under its own "Verify" group.
const adminNav: NavSection[] = [
  {
    label: "Manage workspace",
    items: [
      { to: "/admin", label: "Knowledge health", icon: <NavIcon path={Icon.health} /> },
      { to: "/admin/documents", label: "Documents", icon: <NavIcon path={Icon.docs} /> },
      { to: "/admin/notifications", label: "Notifications", icon: <NavIcon path={Icon.bell} /> },
      { to: "/admin/conflicts", label: "Conflicts", icon: <NavIcon path={Icon.conflict} /> },
      { to: "/admin/insights", label: "Questions & feedback", icon: <NavIcon path={Icon.insights} /> },
      { to: "/admin/logins", label: "Login activity", icon: <NavIcon path={Icon.logins} /> },
      { to: "/admin/settings", label: "Settings", icon: <NavIcon path={Icon.settings} /> },
    ],
  },
  {
    label: "Verify",
    items: [{ to: "/chat", label: "Test a question", icon: <NavIcon path={Icon.chat} /> }],
  },
  {
    label: "Account",
    items: [{ to: "/profile", label: "Profile", icon: <NavIcon path={Icon.profile} /> }],
  },
];

const PAGE_TITLES: Record<string, string> = {
  "/chat": "Assistant",
  "/profile": "Profile",
  "/notifications": "Notifications",
  "/reminders": "Reminders",
  "/admin": "Knowledge health",
  "/admin/documents": "Documents",
  "/admin/notifications": "Manage notifications",
  "/admin/insights": "Questions & feedback",
  "/admin/conflicts": "Conflicts",
  "/admin/logins": "Login activity",
  "/admin/settings": "Settings",
};

const RAIL_KEY = "cm_nav_collapsed";

function readCollapsed(): boolean | null {
  try {
    const v = localStorage.getItem(RAIL_KEY);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}

/**
 * Layout for every signed-in page: one sidebar for every role, grouped into
 * labelled sections. Expanded it shows text labels; collapsed it is an icon
 * rail (each item keeps an accessible name and a tooltip). Below `md` it
 * becomes a drawer opened from a labelled "Menu" button in the top bar.
 * `fullBleed` pages such as chat fill the space instead of a padded column.
 */
export function AppShell({ children, fullBleed = false }: { children: ReactNode; fullBleed?: boolean }) {
  const { role, collegeName } = useAuthStore();
  const t = useT();
  const unread = useNotificationStore((s) => s.unread);
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] ?? "Workspace";
  // Signed-in pages are private: give each a meaningful tab title and keep
  // them out of search results.
  usePageMeta({ title, noindex: true });
  const isAdmin = role === "admin";
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Chat has its own conversation list, so the rail starts collapsed there
  // until the user chooses otherwise.
  const [stored, setStored] = useState<boolean | null>(readCollapsed);
  const collapsed = stored ?? fullBleed;

  const toggleCollapsed = () => {
    const next = !collapsed;
    setStored(next);
    try {
      localStorage.setItem(RAIL_KEY, next ? "1" : "0");
    } catch {
      // Not persisted; still applies for this session.
    }
  };

  useEffect(() => setDrawerOpen(false), [location.pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const sections: NavSection[] = isAdmin
    ? adminNav
    : [
        {
          label: "Campus",
          items: [
            { to: "/chat", label: t("nav.assistant"), icon: <NavIcon path={Icon.chat} /> },
            { to: "/notifications", label: t("nav.notifications"), icon: <NavIcon path={Icon.bell} /> },
            { to: "/reminders", label: t("nav.reminders"), icon: <NavIcon path={Icon.calendar} /> },
          ],
        },
        {
          label: "Account",
          items: [{ to: "/profile", label: t("nav.profile"), icon: <NavIcon path={Icon.profile} /> }],
        },
      ];

  // `rail` = the collapsed desktop presentation; the mobile drawer is never a rail.
  const renderNav = (rail: boolean) => (
    <nav aria-label="Main" className="flex-1 py-4 overflow-y-auto">
      {sections.map((section) => (
        <div key={section.label} className="mb-5">
          {rail ? (
            <div className="mx-3 mb-1.5 border-t border-line" aria-hidden="true" />
          ) : (
            <p className="label-caps px-5 mb-1.5">{section.label}</p>
          )}
          <div className="flex flex-col">
            {section.items.map((item) => {
              const badge = item.to === "/notifications" && !isAdmin && unread > 0;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end
                  title={rail ? item.label : undefined}
                  aria-label={rail ? item.label : undefined}
                  className={({ isActive }) =>
                    `relative flex items-center gap-3 min-h-11 text-sm border-l-2 transition-colors ${
                      rail ? "justify-center px-0" : "px-5"
                    } ${
                      isActive
                        ? "border-violet-500 bg-violet-50 text-violet-600 font-medium"
                        : "border-transparent text-ink-700 hover:bg-surface-hover hover:text-ink-950"
                    }`
                  }
                >
                  {item.icon}
                  {!rail && <span className="truncate">{item.label}</span>}
                  {badge && (
                    <span
                      className={`min-w-5 h-5 px-1 rounded-[3px] bg-seal-coral-600 text-white text-[11px] leading-5 font-medium text-center ${
                        rail ? "absolute top-1.5 right-2" : "ml-auto"
                      }`}
                      aria-label={`${unread} unread`}
                    >
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className={`bg-paper-100 flex ${fullBleed ? "h-dvh overflow-hidden" : "min-h-dvh"}`}>
      {/* Desktop sidebar */}
      <aside
        aria-label="Workspace navigation"
        className={`hidden md:flex sticky top-0 h-dvh shrink-0 flex-col bg-surface border-r border-line transition-[width] duration-200 ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        <div className={`h-14 flex items-center border-b border-line shrink-0 ${collapsed ? "justify-center" : "px-5"}`}>
          <Link to={isAdmin ? "/admin" : "/chat"} aria-label="CampusMind AI home">
            {collapsed ? <MarkIcon size={26} /> : <Wordmark className="text-base" />}
          </Link>
        </div>
        {!collapsed && collegeName && (
          <div className="px-5 py-3 border-b border-line">
            <p className="label-caps">{isAdmin ? "Workspace" : "College"}</p>
            <p className="text-sm font-medium text-ink-900 mt-0.5 truncate">{collegeName}</p>
          </div>
        )}
        {renderNav(collapsed)}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          className={`h-11 shrink-0 border-t border-line flex items-center gap-2 text-sm text-ink-500 hover:text-ink-950 hover:bg-surface-hover ${
            collapsed ? "justify-center" : "px-5"
          }`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path
              d={collapsed ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {!collapsed && <span>Collapse</span>}
        </button>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/45"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-surface border-r border-line flex flex-col">
            <div className="h-14 flex items-center justify-between px-5 border-b border-line shrink-0">
              <Wordmark className="text-base" />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="min-h-10 px-3 -mr-2 rounded-[var(--radius-control)] text-sm text-ink-700 hover:bg-surface-hover"
              >
                Close
              </button>
            </div>
            {collegeName && (
              <div className="px-5 py-3 border-b border-line">
                <p className="label-caps">{isAdmin ? "Workspace" : "College"}</p>
                <p className="text-sm font-medium text-ink-900 mt-0.5 truncate">{collegeName}</p>
              </div>
            )}
            {renderNav(false)}
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 h-14 shrink-0 bg-surface border-b border-line flex items-center gap-2 sm:gap-3 px-3 sm:px-5">
          <button
            type="button"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
            className="md:hidden inline-flex items-center gap-2 min-h-10 px-2.5 -ml-1 rounded-[var(--radius-control)] text-sm font-medium text-ink-800 border border-line-strong hover:bg-surface-hover"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Menu
          </button>
          <h2 className="font-display text-base text-ink-950 truncate">{title}</h2>
          <div className="ml-auto flex items-center gap-1">
            {!isAdmin && <NotificationBell />}
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
