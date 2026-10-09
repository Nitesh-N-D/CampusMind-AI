import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AppShell } from "@/layouts/AppShell";
import { Badge, Button, EmptyState, ErrorBanner, Input, PageHeader, Select, SkeletonList } from "@/components/ui";
import {
  AttachmentButtons,
  CATEGORY_LABELS,
  CategoryBadge,
  DueBadge,
  PriorityBadge,
  formatWhen,
} from "@/components/notificationUi";
import {
  api,
  ApiError,
  parseUtc,
  type AdminNotificationSummary,
  type NotificationAudience,
  type NotificationCategory,
  type NotificationOut,
} from "@/lib/api";
import { DateStamp } from "@/components/campus";
import { toastError, toastSuccess } from "@/lib/toastStore";

const OFFSETS: { value: number; label: string }[] = [
  { value: 7, label: "7 days before" },
  { value: 3, label: "3 days before" },
  { value: 1, label: "1 day before" },
  { value: 0, label: "Day of" },
];
const FIELD_CLS =
  "rounded-[var(--radius-control)] border border-line-strong px-3.5 py-2.5 text-sm bg-surface text-ink-900 placeholder:text-ink-500 outline-none focus:border-ink-950";
const LABEL_CLS = "text-sm font-semibold text-ink-900";

const ACCEPT = ".pdf,.docx,.jpg,.jpeg,.png,.webp";
const STATE_TONE: Record<string, "neutral" | "teal" | "amber" | "coral"> = {
  published: "teal",
  scheduled: "amber",
  expired: "neutral",
  archived: "neutral",
  draft: "amber",
};

// <input type="datetime-local"> is local wall-clock time; the API wants UTC.
const toUtcIso = (local: string) => (local ? new Date(local).toISOString() : "");
// The reverse, for pre-filling the edit form.
const toLocalInput = (utc: string | null) => {
  if (!utc) return "";
  const d = parseUtc(utc);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const audienceFrom = (student: boolean, faculty: boolean): NotificationAudience | "" =>
  student && faculty ? "both" : student ? "student" : faculty ? "faculty" : "";

function AudienceChecks({
  student,
  faculty,
  onChange,
}: {
  student: boolean;
  faculty: boolean;
  onChange: (student: boolean, faculty: boolean) => void;
}) {
  const chip = (on: boolean) =>
    `flex items-center gap-2 min-h-11 px-3.5 text-sm font-semibold cursor-pointer rounded-[var(--radius-control)] border-[1.5px] transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-focus)] ${
      on ? "bg-lamp text-on-lamp border-ink-950" : "border-line-strong text-ink-800 hover:bg-surface-hover"
    }`;
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className={`${LABEL_CLS} mb-1.5`}>Who sees this</legend>
      <div className="flex flex-wrap gap-2">
        <label className={chip(student)}>
          <input type="checkbox" className="sr-only" checked={student} onChange={(e) => onChange(e.target.checked, faculty)} />
          <span aria-hidden="true">{student ? "◆" : "◇"}</span>
          Students
        </label>
        <label className={chip(faculty)}>
          <input type="checkbox" className="sr-only" checked={faculty} onChange={(e) => onChange(student, e.target.checked)} />
          <span aria-hidden="true">{faculty ? "◆" : "◇"}</span>
          Faculty
        </label>
      </div>
      {!student && !faculty && (
        <span role="alert" className="text-xs font-medium text-seal-coral-700">
          Select at least one audience.
        </span>
      )}
    </fieldset>
  );
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<NotificationCategory>("circular");
  const [priority, setPriority] = useState("normal");
  const [student, setStudent] = useState(true);
  const [faculty, setFaculty] = useState(true);
  const [eventDate, setEventDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [reminderDate, setReminderDate] = useState("");
  const [offsets, setOffsets] = useState<number[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const audience = audienceFrom(student, faculty);
    if (!audience) {
      setError("Please select at least one audience.");
      return;
    }
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("title", title.trim());
    form.set("body", body.trim());
    form.set("category", category);
    form.set("priority", priority);
    form.set("audience", audience);
    if (eventDate) form.set("event_date", toUtcIso(eventDate));
    if (deadline) form.set("deadline", toUtcIso(deadline));
    if (reminderDate) form.set("reminder_date", toUtcIso(reminderDate));
    if (offsets.length) form.set("reminder_offsets", offsets.join(","));
    if (file) form.set("file", file);
    try {
      await api.notifications.publish(form);
      toastSuccess("Notification published.");
      setTitle("");
      setBody("");
      setEventDate("");
      setDeadline("");
      setReminderDate("");
      setOffsets([]);
      setFile(null);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't publish this notification.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="compose-h"
      className="mb-10 bg-surface border-[1.5px] border-ink-950 rounded-[var(--radius-card)] p-5 sm:p-6 shadow-[6px_6px_0_var(--color-lamp)]"
    >
      <p className="label-caps">Official campus communication</p>
      <h2 id="compose-h" className="text-2xl font-bold text-ink-950 mt-1">
        Compose a notice
      </h2>
      <p className="text-sm text-ink-700 mt-1 mb-5 max-w-xl">
        Published notices reach the chosen audience immediately and appear as official notices from your college. Add a
        deadline or date to create reminders automatically.
      </p>
      <form onSubmit={submit} className="grid gap-5 md:grid-cols-2">
        <div className="md:col-span-2">
          <Input id="n-title" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
        </div>
        <Select id="n-category" label="Category" value={category} onChange={(e) => setCategory(e.target.value as NotificationCategory)}>
          {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Select id="n-priority" label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="normal">Normal</option>
          <option value="important">Important</option>
          <option value="urgent">Urgent</option>
        </Select>
        <div className="md:col-span-2 flex flex-col gap-1.5">
          <label htmlFor="n-body" className={LABEL_CLS}>
            Description
          </label>
          <textarea
            id="n-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            rows={4}
            className={FIELD_CLS}
          />
        </div>
        <Input id="n-event" type="datetime-local" label="Date and time (event or holiday)" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
        <Input id="n-deadline" type="datetime-local" label="Deadline" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        <Input
          id="n-reminder"
          type="datetime-local"
          label="Custom reminder date"
          hint="Optional. Must be before the deadline or date."
          value={reminderDate}
          onChange={(e) => setReminderDate(e.target.value)}
        />
        <fieldset className="flex flex-col gap-1.5">
          <legend className={`${LABEL_CLS} mb-1.5`}>Scheduled reminders</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {OFFSETS.map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-sm min-h-11 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-[var(--color-navy-700)]"
                  checked={offsets.includes(o.value)}
                  onChange={(e) =>
                    setOffsets((prev) => (e.target.checked ? [...prev, o.value] : prev.filter((x) => x !== o.value)))
                  }
                />
                {o.label}
              </label>
            ))}
          </div>
          {offsets.length > 0 && !deadline && !eventDate && (
            <span role="alert" className="text-xs font-medium text-seal-coral-700">Reminders need a deadline or date.</span>
          )}
        </fieldset>
        <AudienceChecks student={student} faculty={faculty} onChange={(s, f) => (setStudent(s), setFaculty(f))} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="n-file" className={LABEL_CLS}>
            Attachment
          </label>
          <input
            id="n-file"
            type="file"
            accept={ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-ink-800 file:mr-3 file:min-h-11 file:px-4 file:border file:border-line-strong file:rounded-[var(--radius-control)] file:bg-surface file:text-ink-900 file:font-semibold"
          />
          <span className="text-xs text-ink-700">PDF, DOCX, JPG, JPEG, PNG or WEBP. Old .doc files aren't supported; save as .docx.</span>
        </div>
        {error && (
          <div className="md:col-span-2">
            <ErrorBanner message={error} />
          </div>
        )}
        <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-line">
          <p className="data text-ink-500">
            Audience: {student && faculty ? "students + faculty" : student ? "students" : faculty ? "faculty" : "none"}
            {deadline || eventDate ? " · reminders enabled" : ""}
          </p>
          <Button type="submit" disabled={busy}>
            {busy ? "Publishing..." : "Publish notice"}
          </Button>
        </div>
      </form>
    </section>
  );
}

function EditRow({ n, onDone }: { n: NotificationOut; onDone: (updated?: NotificationOut) => void }) {
  const [title, setTitle] = useState(n.title);
  const [body, setBody] = useState(n.body);
  const [priority, setPriority] = useState(n.priority);
  const [student, setStudent] = useState(n.audience !== "faculty");
  const [faculty, setFaculty] = useState(n.audience !== "student");
  const [deadline, setDeadline] = useState(toLocalInput(n.deadline));
  const [eventDate, setEventDate] = useState(toLocalInput(n.event_date));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const audience = audienceFrom(student, faculty);
    if (!audience) return toastError("Please select at least one audience.");
    setBusy(true);
    try {
      const updated = await api.notifications.update(n.id, {
        title: title.trim(),
        body: body.trim(),
        priority: priority as NotificationOut["priority"],
        audience,
        deadline: deadline ? toUtcIso(deadline) : null,
        event_date: eventDate ? toUtcIso(eventDate) : null,
      });
      toastSuccess("Notification updated.");
      onDone(updated);
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : "Couldn't update this notification.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3 md:grid-cols-2 mt-3">
      <div className="md:col-span-2">
        <Input id={`e-title-${n.id}`} label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="md:col-span-2 flex flex-col gap-1.5">
        <label htmlFor={`e-body-${n.id}`} className={LABEL_CLS}>
          Description
        </label>
        <textarea
          id={`e-body-${n.id}`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className={FIELD_CLS}
        />
      </div>
      <Input id={`e-event-${n.id}`} type="datetime-local" label="Date and time" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
      <Input id={`e-deadline-${n.id}`} type="datetime-local" label="Deadline" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
      <Select id={`e-priority-${n.id}`} label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as NotificationOut["priority"])}>
        <option value="normal">Normal</option>
        <option value="important">Important</option>
        <option value="urgent">Urgent</option>
      </Select>
      <AudienceChecks student={student} faculty={faculty} onChange={(s, f) => (setStudent(s), setFaculty(f))} />
      <div className="md:col-span-2 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button onClick={save} disabled={busy}>
          Save changes
        </Button>
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-l-[3px] border-ink-950 pl-3">
      <dt className="text-xs text-ink-700">{label}</dt>
      <dd className="data !text-2xl font-semibold text-ink-950">{value}</dd>
    </div>
  );
}

function UpcomingList({ title, items }: { title: string; items: NotificationOut[] }) {
  return (
    <section aria-label={title}>
      <h3 className="label-caps !text-ink-950 pb-2 border-b border-line-strong">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-ink-500 pt-2">Nothing upcoming.</p>
      ) : (
        <ul>
          {items.map((n) => {
            const when = n.deadline ?? n.event_date;
            return (
              <li key={n.id} className="flex items-start gap-3 py-2.5 border-b border-line text-sm">
                {when && <DateStamp date={when} state="later" className="scale-90 origin-top-left" />}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink-900 break-words">{n.title}</p>
                  <div className="mt-1">
                    <DueBadge n={n} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function AdminNotifications() {
  const [items, setItems] = useState<NotificationOut[] | null>(null);
  const [summary, setSummary] = useState<AdminNotificationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [audience, setAudience] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, sum] = await Promise.all([
        api.notifications.list({ category, audience, status }),
        api.notifications.summary(),
      ]);
      setItems(list);
      setSummary(sum);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load notifications.");
    }
  }, [category, audience, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const archive = async (n: NotificationOut) => {
    if (!confirm(`Archive "${n.title}"? Students and faculty will stop seeing it and its pending reminders are cancelled.`)) return;
    try {
      await api.notifications.archive(n.id);
      toastSuccess("Notification archived.");
      void load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : "Couldn't archive this notification.");
    }
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Admin"
        title="Notifications & reminders"
        description="Publish official circulars, holidays and deadlines to students and faculty. Only admins can publish."
        actions={<Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? "Close" : "New notification"}</Button>}
      />

      {showCreate && (
        <CreateForm
          onCreated={() => {
            setShowCreate(false);
            void load();
          }}
        />
      )}

      {summary && (
        <>
          <dl className="grid grid-cols-3 gap-x-4 mb-8">
            <SummaryStat label="Total published" value={summary.total} />
            <SummaryStat label="Active circulars" value={summary.active_circulars} />
            <SummaryStat label="Scheduled reminders" value={summary.scheduled_reminders} />
          </dl>
          <div className="grid gap-x-10 gap-y-6 md:grid-cols-2 mb-10">
            <UpcomingList title="Upcoming deadlines" items={summary.upcoming_deadlines} />
            <UpcomingList title="Upcoming holidays" items={summary.upcoming_holidays} />
          </div>
        </>
      )}

      <div className="flex flex-wrap gap-3 mb-5">
        <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Select aria-label="Audience" value={audience} onChange={(e) => setAudience(e.target.value)}>
          <option value="">All audiences</option>
          <option value="student">Students</option>
          <option value="faculty">Faculty</option>
          <option value="both">Both</option>
        </Select>
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Published and scheduled</option>
          <option value="published">Published</option>
          <option value="scheduled">Scheduled</option>
          <option value="expired">Expired</option>
          <option value="archived">Archived</option>
        </Select>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {!error && items === null && <SkeletonList count={3} lines={2} />}
      {items && items.length === 0 && (
        <EmptyState title="No notifications match" body="Publish a notification, or change the filters above." />
      )}

      <ul className="border-t border-line-strong">
        {items?.map((n) => {
          const scheduled = n.state === "scheduled";
          const dim = n.state === "archived" || n.state === "expired";
          const official = n.verified || n.category === "circular";
          return (
            <li
              key={n.id}
              className={`py-5 pl-4 pr-1 border-b border-line border-l-[5px] ${
                scheduled ? "border-l-seal-amber-600 border-dashed" : dim ? "border-l-line-strong" : "border-l-lamp"
              } ${dim ? "opacity-75" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={STATE_TONE[n.state] ?? "neutral"}>
                  {scheduled ? `Scheduled · goes live ${formatWhen(n.published_at)}` : n.state}
                </Badge>
                {official && <Badge tone="violet">Official notice</Badge>}
                <CategoryBadge category={n.category} />
                <PriorityBadge priority={n.priority} />
                <DueBadge n={n} />
              </div>
              <h3 className={`mt-2 font-bold text-ink-950 break-words ${official ? "text-xl" : "text-base"}`}>{n.title}</h3>
              <p className="data text-ink-500 mt-1">
                To {n.audience === "both" ? "students + faculty" : n.audience === "student" ? "students" : "faculty"}
                {n.attachment ? " · attachment" : ""}
                {n.reminder_offsets && n.reminder_offsets.length > 0
                  ? ` · reminders ${n.reminder_offsets.map((o) => (o === 0 ? "day of" : `${o}d`)).join(", ")}`
                  : ""}
              </p>
              {editing === n.id ? (
                <EditRow
                  n={n}
                  onDone={(updated) => {
                    setEditing(null);
                    if (updated) void load();
                  }}
                />
              ) : (
                <>
                  <p className="text-sm text-ink-700 mt-2 whitespace-pre-line">{n.body}</p>
                  {!scheduled && <p className="data text-ink-500 mt-2">Published {formatWhen(n.published_at)}</p>}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <AttachmentButtons n={n} />
                    {n.state !== "archived" && (
                      <div className="flex gap-2">
                        <Button variant="secondary" onClick={() => setEditing(n.id)}>
                          Edit
                        </Button>
                        <Button variant="danger" onClick={() => archive(n)}>
                          Archive
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </AppShell>
  );
}
