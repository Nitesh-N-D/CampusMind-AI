import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/layouts/AppShell";
import { Button, EmptyState, ErrorBanner, PageHeader, SkeletonList } from "@/components/ui";
import { Link } from "react-router-dom";
import { AskCampusMindButton, AttachmentButtons, CategoryBadge, DueBadge, PriorityBadge, formatWhen } from "@/components/notificationUi";
import { api, ApiError, parseUtc, type NotificationOut, type ReminderBuckets } from "@/lib/api";

const SECTIONS: { key: keyof ReminderBuckets; title: string; empty: string }[] = [
  { key: "today", title: "Today", empty: "Nothing due today." },
  { key: "this_week", title: "This week", empty: "Nothing in the next 7 days." },
  { key: "upcoming", title: "Upcoming", empty: "No later dates yet." },
  { key: "past", title: "Past", empty: "Nothing here yet." },
];

function ReminderRow({ n }: { n: NotificationOut }) {
  const raw = n.deadline ?? n.event_date;
  const when = raw ? parseUtc(raw) : null;
  return (
    <li className="flex gap-4 sm:gap-5 p-4 sm:p-5">
      <div className="w-14 shrink-0 text-center border border-line-strong rounded-[var(--radius-control)] py-1.5 self-start">
        {when ? (
          <>
            <p className="label-caps !text-[10px]">{when.toLocaleString(undefined, { month: "short" })}</p>
            <p className="font-display text-2xl leading-none text-ink-950 mt-0.5">{when.getDate()}</p>
          </>
        ) : (
          <p className="label-caps py-2">No date</p>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <CategoryBadge category={n.category} />
          <PriorityBadge priority={n.priority} />
          <DueBadge n={n} />
        </div>
        <h3 className="font-medium text-ink-950 mt-1.5">{n.title}</h3>
        <p className="text-sm text-ink-700 mt-1 line-clamp-2">{n.body}</p>
        <p className="text-xs text-ink-500 mt-1.5 font-mono">
          {n.department ? `${n.department} · ` : ""}
          {when ? formatWhen(raw as string) : ""}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <AskCampusMindButton title={n.title} />
          <AttachmentButtons n={n} />
        </div>
      </div>
    </li>
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
          title="No dated reminders yet."
          body="Deadlines and events from official notices your college publishes appear here, grouped by when they fall. Reminders are created from those notices; they can't be added by hand."
          action={
            <Link to="/notifications">
              <Button variant="secondary">View notifications</Button>
            </Link>
          }
        />
      )}
      {data && !empty && (
        <div className="grid gap-8">
          {SECTIONS.map(({ key, title, empty: emptyText }) => (
            <section key={key} aria-labelledby={`rem-${key}`}>
              <h2 id={`rem-${key}`} className="label-caps !text-ink-800 mb-2 pb-2 border-b border-line-strong">
                {title}
                <span className="ml-2 text-ink-400">{data[key].length}</span>
              </h2>
              {data[key].length === 0 ? (
                <p className="text-sm text-ink-500">{emptyText}</p>
              ) : (
                <ul className="border border-line rounded-[var(--radius-card)] bg-surface divide-y divide-line">
                  {data[key].map((n) => (
                    <ReminderRow key={n.id} n={n} />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </AppShell>
  );
}
