import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { api, ApiError, type DetectedEvent, type DocumentOut, type NotificationAudience, type NotificationCategory } from "@/lib/api";
import { toastError, toastSuccess } from "@/lib/toastStore";

const KIND_LABEL: Record<DetectedEvent["kind"], string> = {
  deadline: "Deadline",
  holiday: "Holiday",
  examination: "Exam",
  event: "Event",
  date: "Date",
};

const KIND_CATEGORY: Record<DetectedEvent["kind"], NotificationCategory> = {
  deadline: "deadline",
  holiday: "holiday",
  examination: "examination",
  event: "event",
  date: "general",
};

// Reminders that are already in the past are skipped by the server.
const DEFAULT_OFFSETS = [7, 3, 1, 0];

function EventRow({ doc, event }: { doc: DocumentOut; event: DetectedEvent }) {
  const [open, setOpen] = useState(false);
  const [student, setStudent] = useState(true);
  const [faculty, setFaculty] = useState(true);
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState(false);

  const publish = async () => {
    const audience: NotificationAudience | "" =
      student && faculty ? "both" : student ? "student" : faculty ? "faculty" : "";
    if (!audience) return toastError("Please select at least one audience.");
    const [y, m, d] = event.date.split("-").map(Number);
    // Deadlines run to the end of the day; everything else is a morning date.
    const when = new Date(y, m - 1, d, event.kind === "deadline" ? 23 : 9, event.kind === "deadline" ? 59 : 0).toISOString();
    setBusy(true);
    try {
      await api.reminders.create({
        title: `${KIND_LABEL[event.kind]}: ${doc.title}`,
        body: event.text,
        category: KIND_CATEGORY[event.kind],
        audience,
        document_id: doc.id,
        reminder_offsets: DEFAULT_OFFSETS,
        ...(event.kind === "deadline" ? { deadline: when } : { event_date: when }),
      });
      setPublished(true);
      toastSuccess("Reminder published.");
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : "Couldn't publish this reminder.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="py-2 border-t border-line first:border-t-0">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="amber">{KIND_LABEL[event.kind]}</Badge>
        <span className="font-medium text-ink-800">{new Date(`${event.date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
        <span className="text-ink-500 truncate flex-1 min-w-[10rem]" title={event.text}>
          {event.text}
        </span>
        {published ? (
          <Badge tone="teal">Published</Badge>
        ) : (
          <Button variant="secondary" className="!py-1 !px-3 text-xs" onClick={() => setOpen((v) => !v)}>
            Publish Reminder
          </Button>
        )}
      </div>
      {open && !published && (
        <div className="mt-2 flex flex-wrap items-center gap-4 pl-1 text-sm">
          <span className="text-ink-500">Send to:</span>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={student} onChange={(e) => setStudent(e.target.checked)} /> Students
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={faculty} onChange={(e) => setFaculty(e.target.checked)} /> Faculty
          </label>
          <Button className="!py-1 !px-3 text-xs" onClick={publish} disabled={busy || (!student && !faculty)}>
            {busy ? "Publishing..." : "Confirm and publish"}
          </Button>
        </div>
      )}
    </li>
  );
}

/** Suggestions only: nothing is published until an admin confirms. */
export function DetectedEvents({ doc }: { doc: DocumentOut }) {
  const events = doc.detected_events ?? [];
  const [open, setOpen] = useState(false);
  if (events.length === 0) return null;
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-xs font-medium text-violet-600 underline underline-offset-2"
      >
        {open ? "Hide" : "Show"} {events.length} detected date{events.length === 1 ? "" : "s"}
      </button>
      {open && (
        <div className="mt-2">
          <p className="text-xs text-ink-500 mb-1">
            Found automatically in this document. Review each one - nothing is sent until you publish it.
          </p>
          <ul>
            {events.map((e) => (
              <EventRow key={`${e.kind}-${e.date}-${e.text}`} doc={doc} event={e} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
