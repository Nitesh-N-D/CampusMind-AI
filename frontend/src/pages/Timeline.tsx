import { useEffect, useState } from "react";
import { AppShell } from "@/layouts/AppShell";
import { PageHeader, ErrorBanner, EmptyState, SkeletonList, Badge } from "@/components/ui";
import { api, ApiError, type TimelineEvent } from "@/lib/api";

const RANGES = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "upcoming", label: "Upcoming" },
];

const CATEGORIES = [
  { value: "", label: "All" },
  { value: "academic", label: "Academic" },
  { value: "exam", label: "Exams" },
  { value: "placement", label: "Placements" },
  { value: "fees", label: "Fees" },
  { value: "event", label: "Events" },
  { value: "deadline", label: "Deadlines" },
];

const CATEGORY_TONE: Record<string, "neutral" | "teal" | "amber" | "coral" | "violet"> = {
  academic: "violet",
  exam: "coral",
  placement: "teal",
  fees: "amber",
  event: "violet",
  deadline: "coral",
};

export default function Timeline() {
  const [range, setRange] = useState("upcoming");
  const [category, setCategory] = useState("");
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.timeline({ range, category: category || undefined });
      setEvents(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load the campus timeline.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, category]);

  const grouped = (events ?? []).reduce<Record<string, TimelineEvent[]>>((acc, ev) => {
    const key = new Date(ev.event_date).toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    acc[key] = acc[key] || [];
    acc[key].push(ev);
    return acc;
  }, {});

  return (
    <AppShell>
      <PageHeader
        eyebrow="Campus timeline"
        title="What's coming up"
        description="Deadlines and dates extracted automatically from official circulars and notices."
      />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <div className="flex gap-1 bg-paper-200 p-1 rounded-[var(--radius-control)] w-fit">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={`px-3.5 py-1.5 text-sm rounded-[6px] transition-colors ${
                range === r.value ? "bg-surface text-ink-950 font-medium shadow-sm" : "text-ink-500"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              onClick={() => setCategory(c.value)}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                category === c.value
                  ? "bg-navy-700 text-paper-50 border-navy-700"
                  : "bg-surface text-ink-600 border-line-strong hover:border-navy-700"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <SkeletonList count={4} lines={2} />}

      {error && <ErrorBanner message={error} onRetry={load} />}

      {!loading && !error && (events?.length ?? 0) === 0 && (
        <EmptyState
          title="Nothing on the timeline yet"
          body="Once your admin uploads documents with dates - exam schedules, fee notices, placement circulars - they'll show up here automatically."
        />
      )}

      {!loading && !error && Object.keys(grouped).length > 0 && (
        <div className="relative pl-6 border-l-2 border-line space-y-8">
          {Object.entries(grouped).map(([date, items]) => (
            <div key={date} className="relative">
              <div className="absolute -left-[29px] top-1 w-3 h-3 rounded-full bg-navy-700 ring-4 ring-paper-100" />
              <p className="text-sm font-medium text-ink-900 mb-3" style={{ fontFamily: "var(--font-mono)" }}>
                {date}
              </p>
              <div className="space-y-2.5">
                {items.map((ev) => (
                  <div key={ev.id} className="bg-surface border border-line rounded-[var(--radius-card)] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-ink-800">{ev.title}</p>
                      <Badge tone={CATEGORY_TONE[ev.category] ?? "neutral"}>{ev.category}</Badge>
                    </div>
                    {ev.department && <p className="text-xs text-ink-400 mt-1.5">{ev.department}</p>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
