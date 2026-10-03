import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/layouts/AppShell";
import { Card, EmptyState, ErrorBanner, PageHeader, SkeletonList } from "@/components/ui";
import { AttachmentButtons, CategoryBadge, DueBadge, PriorityBadge, formatWhen } from "@/components/notificationUi";
import { api, ApiError, type NotificationOut, type ReminderBuckets } from "@/lib/api";

const SECTIONS: { key: keyof ReminderBuckets; title: string; empty: string }[] = [
  { key: "today", title: "Today", empty: "Nothing due today." },
  { key: "this_week", title: "This week", empty: "Nothing in the next 7 days." },
  { key: "upcoming", title: "Upcoming", empty: "No later dates yet." },
  { key: "past", title: "Past", empty: "Nothing here yet." },
];

function ReminderCard({ n }: { n: NotificationOut }) {
  const date = n.deadline ?? n.event_date;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium text-ink-900">{n.title}</h3>
        <CategoryBadge category={n.category} />
        <PriorityBadge priority={n.priority} />
        <DueBadge n={n} />
      </div>
      <p className="text-sm text-ink-700 mt-1.5 line-clamp-2">{n.body}</p>
      {date && <p className="text-xs text-ink-400 mt-1.5">{formatWhen(date)}</p>}
      {n.attachment && (
        <div className="mt-2">
          <AttachmentButtons n={n} />
        </div>
      )}
    </Card>
  );
}

export default function Reminders() {
  const [data, setData] = useState<ReminderBuckets | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.reminders.list());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load reminders.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const empty = data && SECTIONS.every((s) => data[s.key].length === 0);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Calendar"
        title="Reminders"
        description="Deadlines, holidays, exams and events your college has announced, grouped by when they fall."
      />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!error && !data && <SkeletonList count={3} lines={2} />}
      {empty && (
        <EmptyState
          title="No dated reminders"
          body="Deadlines and events published by your college will appear here."
        />
      )}
      {data && !empty && (
        <div className="grid gap-8">
          {SECTIONS.map(({ key, title, empty: emptyText }) => (
            <section key={key} aria-labelledby={`rem-${key}`}>
              <h2 id={`rem-${key}`} className="font-display text-lg text-ink-950 mb-3">
                {title}
              </h2>
              {data[key].length === 0 ? (
                <p className="text-sm text-ink-400">{emptyText}</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {data[key].map((n) => (
                    <ReminderCard key={n.id} n={n} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </AppShell>
  );
}
