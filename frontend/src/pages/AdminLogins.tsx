import { useEffect, useState } from "react";
import { AppShell } from "@/layouts/AppShell";
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, PageHeader, SkeletonList } from "@/components/ui";
import { api, ApiError, type LoginEventPage } from "@/lib/api";

const PAGE_SIZE = 25;

type RoleFilter = "" | "student" | "faculty";

const ROLE_OPTIONS: { value: RoleFilter; label: string }[] = [
  { value: "", label: "Everyone" },
  { value: "student", label: "Students" },
  { value: "faculty", label: "Faculty" },
];

// Date inputs give "YYYY-MM-DD" in the admin's own calendar; the API takes
// exact instants, so turn each day into its local midnight.
function localMidnight(day: string, addDays = 0): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d + addDays).toISOString();
}

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function AdminLogins() {
  const [role, setRole] = useState<RoleFilter>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LoginEventPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const rangeInvalid = Boolean(from && to && from > to);

  const load = async () => {
    if (rangeInvalid) return;
    setLoading(true);
    setError(null);
    try {
      setData(
        await api.admin.loginEvents({
          role: role || undefined,
          start: from ? localMidnight(from) : undefined,
          // "To" is inclusive for the admin, so the bound is the next midnight.
          end: to ? localMidnight(to, 1) : undefined,
          page: String(page),
          page_size: String(PAGE_SIZE),
        })
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load login activity.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, from, to, page]);

  const changeFilter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  const filtered = Boolean(role || from || to);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const firstShown = data && data.total > 0 ? (data.page - 1) * data.page_size + 1 : 0;
  const lastShown = data ? firstShown + data.items.length - (data.items.length ? 1 : 0) : 0;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Admin"
        title="Login activity"
        description="Every successful student and faculty sign-in and registration in your workspace. Times are shown in your local time zone."
      />

      <Card className="p-4 sm:p-5 mb-6">
        <div className="flex flex-col lg:flex-row lg:items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-800" id="role-filter-label">
              Role
            </span>
            <div
              role="radiogroup"
              aria-labelledby="role-filter-label"
              className="flex gap-1 bg-paper-200 p-1 rounded-[var(--radius-control)]"
            >
              {ROLE_OPTIONS.map((opt) => (
                <button
                  key={opt.value || "all"}
                  type="button"
                  role="radio"
                  aria-checked={role === opt.value}
                  onClick={() => changeFilter(() => setRole(opt.value))}
                  className={`flex-1 lg:flex-none px-3.5 h-9 text-sm rounded-[6px] transition-colors ${
                    role === opt.value ? "bg-surface text-ink-950 font-medium shadow-sm" : "text-ink-500 hover:text-ink-900"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:flex lg:gap-4">
            <Input
              id="from"
              type="date"
              label="From"
              value={from}
              max={to || undefined}
              onChange={(e) => changeFilter(() => setFrom(e.target.value))}
            />
            <Input
              id="to"
              type="date"
              label="To"
              value={to}
              min={from || undefined}
              onChange={(e) => changeFilter(() => setTo(e.target.value))}
            />
          </div>
          {filtered && (
            <Button
              variant="ghost"
              className="self-start lg:self-end"
              onClick={() =>
                changeFilter(() => {
                  setRole("");
                  setFrom("");
                  setTo("");
                })
              }
            >
              Clear filters
            </Button>
          )}
        </div>
        {rangeInvalid && (
          <p className="mt-3 text-xs text-seal-coral-700">The "From" date must be on or before the "To" date.</p>
        )}
      </Card>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading && !data && <SkeletonList count={5} lines={1} />}

      {data && !error && data.total === 0 && (
        <EmptyState
          title={filtered ? "No sign-ins match these filters" : "No sign-ins yet"}
          body={
            filtered
              ? "Try a wider date range or a different role."
              : "Student and faculty sign-ins and registrations will be listed here as they happen."
          }
        />
      )}

      {data && !error && data.total > 0 && (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={loading}>
          {/* Phones: stacked cards */}
          <ul className="md:hidden flex flex-col gap-2">
            {data.items.map((e) => (
              <li key={e.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900 truncate">{e.full_name}</p>
                      <p className="text-xs text-ink-500 truncate">{e.email}</p>
                    </div>
                    <Badge tone={e.role === "faculty" ? "violet" : "neutral"}>{e.role}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-ink-500">
                    {e.event_type === "register" ? "Registered" : "Signed in"} · {timeFormat.format(new Date(e.created_at))}
                  </p>
                </Card>
              </li>
            ))}
          </ul>

          {/* Tablet and up: table */}
          <Card className="hidden md:block overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-500 border-b border-line">
                  <th scope="col" className="px-5 py-3 font-medium">Name</th>
                  <th scope="col" className="px-5 py-3 font-medium">Role</th>
                  <th scope="col" className="px-5 py-3 font-medium">Activity</th>
                  <th scope="col" className="px-5 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((e) => (
                  <tr key={e.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3">
                      <p className="font-medium text-ink-900">{e.full_name}</p>
                      <p className="text-xs text-ink-500">{e.email}</p>
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={e.role === "faculty" ? "violet" : "neutral"}>{e.role}</Badge>
                    </td>
                    <td className="px-5 py-3 text-ink-700">
                      {e.event_type === "register" ? "Registered" : "Signed in"}
                    </td>
                    <td className="px-5 py-3 text-ink-700 whitespace-nowrap">
                      <time dateTime={e.created_at}>{timeFormat.format(new Date(e.created_at))}</time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
            <p className="text-xs text-ink-500">
              Showing {firstShown}-{lastShown} of {data.total}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-xs text-ink-500 px-1">
                Page {data.page} of {totalPages}
              </span>
              <Button
                variant="secondary"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
