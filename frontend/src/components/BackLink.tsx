import { useLocation, useNavigate } from "react-router-dom";

/**
 * The one "go back" control for secondary pages (legal, registration, 404).
 *
 * Returns to the previous in-app page when there is one. React Router gives
 * the first entry of a session the key "default", so a page opened directly
 * (a shared link, a refresh) falls back to `fallback` instead of sending the
 * user out of the app or nowhere. Compact on purpose: it is navigation, not a
 * call to action, so the page title stays the strongest element.
 */
export function BackLink({ fallback = "/", className = "" }: { fallback?: string; className?: string }) {
  const navigate = useNavigate();
  const { key } = useLocation();

  return (
    <button
      type="button"
      onClick={() => (key !== "default" ? navigate(-1) : navigate(fallback))}
      aria-label="Back"
      title="Back"
      className={`inline-flex items-center gap-1.5 min-h-10 -ml-2 pl-2 pr-3 rounded-[var(--radius-control)] text-sm font-medium text-ink-700 hover:text-ink-950 hover:bg-surface-hover ${className}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
        <path d="M19 12H5M11 6l-6 6 6 6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>Back</span>
    </button>
  );
}
