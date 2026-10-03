import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AppShell } from "@/layouts/AppShell";
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, PageHeader, Select, SkeletonList } from "@/components/ui";
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
import { toastError, toastSuccess } from "@/lib/toastStore";

const OFFSETS: { value: number; label: string }[] = [
  { value: 7, label: "7 days before" },
  { value: 3, label: "3 days before" },
  { value: 1, label: "1 day before" },
  { value: 0, label: "Day of" },
];
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
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium text-ink-800 mb-1.5">Audience</legend>
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={student} onChange={(e) => onChange(e.target.checked, faculty)} />
          Students
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={faculty} onChange={(e) => onChange(student, e.target.checked)} />
          Faculty
        </label>
      </div>
      {!student && !faculty && <span className="text-xs text-seal-coral-700">Select at least one audience.</span>}
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
    <Card className="p-5 mb-8">
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
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
          <label htmlFor="n-body" className="text-sm font-medium text-ink-800">
            Description
          </label>
          <textarea
            id="n-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            rows={4}
            className="rounded-[var(--radius-control)] border border-line-strong px-3.5 py-2.5 text-sm bg-surface text-ink-900 outline-none focus:border-violet-500"
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
          <legend className="text-sm font-medium text-ink-800 mb-1.5">Scheduled reminders</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {OFFSETS.map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
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
            <span className="text-xs text-seal-coral-700">Reminders need a deadline or date.</span>
          )}
        </fieldset>
        <AudienceChecks student={student} faculty={faculty} onChange={(s, f) => (setStudent(s), setFaculty(f))} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="n-file" className="text-sm font-medium text-ink-800">
            Attachment
          </label>
          <input id="n-file" type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
          <span className="text-xs text-ink-500">PDF, DOCX, JPG, JPEG, PNG or WEBP. Old .doc files aren't supported; save as .docx.</span>
        </div>
        {error && (
          <div className="md:col-span-2">
            <ErrorBanner message={error} />
          </div>
        )}
        <div className="md:col-span-2 flex justify-end">
          <Button type="submit" disabled={busy}>
            {busy ? "Publishing..." : "Publish notification"}
          </Button>
        </div>
      </form>
    </Card>
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
        <label htmlFor={`e-body-${n.id}`} className="text-sm font-medium text-ink-800">
          Description
        </label>
        <textarea
          id={`e-body-${n.id}`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className="rounded-[var(--radius-control)] border border-line-strong px-3.5 py-2.5 text-sm bg-surface outline-none focus:border-violet-500"
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
        <Button variant="ghost" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button onClick={save} disabled={busy}>
          Save changes
        </Button>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wider text-ink-500">{label}</p>
      <p className="font-display text-2xl text-ink-950 mt-1">{value}</p>
    </Card>
  );
}

function UpcomingList({ title, items }: { title: string; items: NotificationOut[] }) {
  return (
    <Card className="p-4">
      <h3 className="font-medium text-ink-900 mb-2">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-ink-400">Nothing upcoming.</p>
      ) : (
        <ul className="grid gap-2">
          {items.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink-800">{n.title}</span>
              <DueBadge n={n} />
            </li>
          ))}
        </ul>
      )}
    </Card>
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
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-3 mb-4">
            <SummaryCard label="Total published" value={summary.total} />
            <SummaryCard label="Active circulars" value={summary.active_circulars} />
            <SummaryCard label="Scheduled reminders" value={summary.scheduled_reminders} />
          </div>
          <div className="grid gap-3 md:grid-cols-2 mb-8">
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

      <div className="grid gap-3">
        {items?.map((n) => (
          <Card key={n.id} className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium text-ink-900">{n.title}</h3>
              <CategoryBadge category={n.category} />
              <PriorityBadge priority={n.priority} />
              <Badge tone={STATE_TONE[n.state] ?? "neutral"}>{n.state}</Badge>
              <Badge tone="violet">{n.audience === "both" ? "Students + faculty" : n.audience === "student" ? "Students" : "Faculty"}</Badge>
              <DueBadge n={n} />
            </div>
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
                <p className="text-xs text-ink-400 mt-2">
                  Published {formatWhen(n.published_at)}
                  {n.reminder_offsets && n.reminder_offsets.length > 0
                    ? ` - reminders: ${n.reminder_offsets.map((o) => (o === 0 ? "day of" : `${o}d`)).join(", ")}`
                    : ""}
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <AttachmentButtons n={n} />
                  {n.state !== "archived" && (
                    <div className="flex gap-2">
                      <Button variant="secondary" className="!py-1.5 !px-3" onClick={() => setEditing(n.id)}>
                        Edit
                      </Button>
                      <Button variant="danger" className="!py-1.5 !px-3" onClick={() => archive(n)}>
                        Archive
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
