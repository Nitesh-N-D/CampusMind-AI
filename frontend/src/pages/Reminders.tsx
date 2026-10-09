import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/layouts/AppShell";
import { Button, EmptyState, ErrorBanner, PageHeader, SkeletonList } from "@/components/ui";
import { Link } from "react-router-dom";
import { DateStamp } from "@/components/campus";
import { AskCampusMindButton, AttachmentButtons, CategoryBadge, DueBadge, PriorityBadge, formatWhen } from "@/components/notificationUi";
import { api, ApiError, parseUtc, type NotificationOut, type ReminderBuckets } from "@/lib/api";

const SECTIONS: { key: keyof ReminderBuckets; title: string; empty: string }[] = [
  { key: "today", title: "Today", empty: "Nothing due today." },
  { key: "this_week", title: "This week", empty: "Nothing in the next 7 days." },
  { key: "upcoming", title: "Upcoming", empty: "No later dates yet." },
  { key: "past", title: "Past", empty: "Nothing here yet." },
];

function ReminderRow({ n, state }: { n: NotificationOut; state: "past" | "later" | "soon" | "today" }) {
  const raw = n.deadline ?? n.event_date;
  const when = raw ? parseUtc(raw) : null;
  return (
    <li className="flex gap-4 sm:gap-5 py-4 border-b border-line">
      {when ? <DateStamp date={when} state={state} /> : <p className="label-caps w-12 shrink-0 pt-2">No date</p>}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <CategoryBadge category={n.category} />
          <PriorityBadge priority={n.priority} />
          <DueBadge n={n} />
        </div>
        <h3 className="font-semibold text-ink-950 mt-1.5">{n.title}</h3>
        <p className="text-sm text-ink-700 mt-1 line-clamp-2">{n.body}</p>
        <p className="data text-ink-500 mt-1.5">
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

const STATE_BY_BUCKET: Record<keyof ReminderBuckets, "past" | "later" | "soon" | "today"> = {
  today: "today",
  this_week: "soon",
  upcoming: "later",
  past: "past",
};

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
        <div className="thread thread-list grid gap-8">
          {SECTIONS.map(({ key, title, empty: emptyText }) => (
            <section key={key} aria-labelledby={`rem-${key}`} className="flex gap-3">
              <span className="thread-node mt-0.5 z-[1] bg-paper-100" aria-hidden="true">
                <span
                  className={`block w-3.5 h-3.5 rotate-45 outline outline-1 outline-ink-950 ${
                    data[key].length > 0 && key !== "past" ? "bg-lamp" : "bg-paper-100"
                  }`}
                />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id={`rem-${key}`} className="flex items-baseline gap-2 text-xl font-bold text-ink-950 pb-2 border-b border-line-strong">
                  {title}
                  <span className="data text-ink-500">{data[key].length}</span>
                </h2>
                {data[key].length === 0 ? (
                  <p className="text-sm text-ink-500 pt-3">{emptyText}</p>
                ) : (
                  <ul>
                    {data[key].map((n) => (
                      <ReminderRow key={n.id} n={n} state={STATE_BY_BUCKET[key]} />
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </AppShell>
  );
}
