import type { ReactNode } from "react";
import { parseUtc } from "@/lib/api";
import { TrustMeter, type TrustLevel } from "@/components/Seal";

/*
 * CampusMind's shared vocabulary for the things the product is about:
 * documents, sources, supersession (conflicts) and academic time. The same
 * components are used in Chat, Documents, Admin, Notifications and Conflicts
 * so each concept always looks the same.
 */

export type DocStatus = "current" | "archived" | "processing" | "failed" | "draft";

const STATUS_LABEL: Record<DocStatus, string> = {
  current: "Current",
  archived: "Archived",
  processing: "Processing",
  failed: "Failed",
  draft: "Draft",
};

/** Status as a tag whose leading mark differs by shape: ◆ current, ▢ archived. */
export function StatusTag({ status }: { status: DocStatus }) {
  const style =
    status === "current"
      ? "bg-lamp text-on-lamp"
      : status === "failed"
      ? "bg-seal-coral-100 text-seal-coral-900"
      : status === "processing"
      ? "bg-seal-amber-100 text-seal-amber-900"
      : "bg-paper-200 text-ink-700";
  const mark = status === "current" ? "◆" : status === "archived" ? "▢" : status === "failed" ? "▲" : "◐";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-chip)] text-xs font-semibold ${style}`}
    >
      <span aria-hidden="true" className="text-[8px] leading-none">
        {mark}
      </span>
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * The document glyph: a page with a folded corner and its version stamped
 * on it. Current documents get a lamp fold; archived ones are dashed.
 */
export function DocGlyph({
  version,
  status = "current",
  size = 40,
}: {
  version?: number | null;
  status?: DocStatus;
  size?: number;
}) {
  const archived = status === "archived";
  const w = size;
  const h = Math.round(size * 1.2);
  return (
    <svg width={w} height={h} viewBox="0 0 40 48" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d="M4 2h22l10 10v34H4V2Z"
        fill="var(--color-surface-2)"
        stroke="var(--color-ink-700)"
        strokeWidth="1.5"
        strokeDasharray={archived ? "3 3" : undefined}
        strokeLinejoin="round"
      />
      <path
        d="M26 2v10h10"
        fill={status === "current" ? "var(--color-lamp)" : "var(--color-paper-300)"}
        stroke="var(--color-ink-700)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {version != null && (
        <text
          x="20"
          y="35"
          textAnchor="middle"
          fontFamily="var(--font-mono)"
          fontSize="11"
          fontWeight="600"
          fill="var(--color-ink-950)"
        >
          v{version}
        </text>
      )}
    </svg>
  );
}

/** Dates in the product's short form: "14 Mar 2026". */
export function shortDate(value: string | Date): string {
  const d = typeof value === "string" ? parseUtc(value) : value;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Provenance for one source: where an answer or notice comes from.
 * Always the same order: document, then page / version / date / department,
 * then status, then trust. Missing facts are simply left out, never faked.
 */
export function SourceRow({
  index,
  title,
  page,
  section,
  department,
  version,
  date,
  status,
  trustScore,
  trustLevel,
  conflict = false,
}: {
  index?: number;
  title: string;
  page?: number | null;
  section?: string | null;
  department?: string | null;
  version?: number | null;
  date?: string | null;
  status?: DocStatus;
  trustScore?: number;
  trustLevel?: TrustLevel;
  conflict?: boolean;
}) {
  const facts = [
    page ? `p.${page}` : section || null,
    version != null ? `v${version}` : null,
    date ? shortDate(date) : null,
    department,
  ].filter(Boolean);
  return (
    <li className="flex items-center gap-3 py-2.5 min-w-0">
      {index != null && (
        <span
          className="data w-6 h-6 shrink-0 flex items-center justify-center bg-ink-950 text-paper-50 rounded-[var(--radius-chip)] font-semibold"
          aria-label={`Source ${index}`}
        >
          {index}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink-900 truncate">{title}</p>
        <p className="data text-ink-500 truncate">{facts.length ? facts.join("  ·  ") : "Campus document"}</p>
      </div>
      {conflict && <StatusTagText>Conflict</StatusTagText>}
      {status && <StatusTag status={status} />}
      {trustLevel && <TrustMeter score={trustScore} level={trustLevel} size="sm" showScore={false} />}
    </li>
  );
}

function StatusTagText({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-chip)] text-xs font-semibold bg-seal-amber-100 text-seal-amber-900">
      <span aria-hidden="true" className="text-[8px] leading-none">
        ▲
      </span>
      {children}
    </span>
  );
}

export interface Lane {
  /** Short heading: "Version A", "Circular 14 Mar", "Superseded" ... */
  tag: string;
  /** What this source says. */
  value: string;
  /** Where it comes from, in provenance facts. */
  source?: string;
  /** The source that holds today. Gets the lamp mark; the other lane is dimmed. */
  current?: boolean;
}

/**
 * Conflict as supersession: two sources side by side, the older dimmed and
 * the one that holds marked with the lamp, joined by an arrow that says "newer
 * replaces older". If it is not known which is newer, neither lane is marked
 * `current` and both are shown at equal weight with the reasoning underneath.
 */
export function Supersession({ topic, lanes, reasoning }: { topic: string; lanes: [Lane, Lane]; reasoning?: string }) {
  const decided = lanes.some((l) => l.current);
  return (
    <section aria-label={`Conflict: ${topic}`} className="border-[1.5px] border-seal-amber-600 rounded-[var(--radius-card)] overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-2 bg-seal-amber-50 border-b border-seal-amber-600/40">
        <span aria-hidden="true" className="text-seal-amber-900 text-xs">
          ▲
        </span>
        <p className="text-sm font-semibold text-seal-amber-900">Sources disagree: {topic}</p>
      </header>
      <div className="grid md:grid-cols-[1fr_auto_1fr] items-stretch">
        {lanes.map((lane, i) => (
          <div key={i} className={`contents`}>
            {i === 1 && (
              <div
                aria-hidden="true"
                className="flex items-center justify-center text-ink-500 py-1 md:py-0 md:px-1 border-y md:border-y-0 border-line"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="rotate-90 md:rotate-0">
                  <path d="M4 12h15m-5-5 5 5-5 5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
            <div
              className={`px-4 py-3 ${lane.current ? "bg-violet-50 shadow-[inset_4px_0_0_var(--color-lamp)]" : ""} ${
                decided && !lane.current ? "opacity-70" : ""
              }`}
            >
              <p className="label-caps flex items-center gap-2">
                {lane.tag}
                {lane.current && (
                  <span className="px-1.5 rounded-[var(--radius-chip)] bg-lamp text-on-lamp text-[11px] font-bold">Current</span>
                )}
              </p>
              <p className={`text-sm mt-1 break-words ${decided && !lane.current ? "line-through decoration-1" : "font-medium"} text-ink-900`}>
                {lane.value}
              </p>
              {lane.source && <p className="data text-ink-500 mt-1.5 break-words">{lane.source}</p>}
            </div>
          </div>
        ))}
      </div>
      {reasoning && (
        <p className="text-sm text-ink-800 px-4 py-2.5 border-t border-line">
          <span className="font-semibold">Why it matters: </span>
          {reasoning}
        </p>
      )}
    </section>
  );
}

/**
 * Academic time as a stamp: month over day, with an optional state that
 * escalates by fill rather than by hue (outline < filled < lamp).
 *   soon   fills solid ink      : within a week
 *   today  lamp                 : due now
 */
export function DateStamp({
  date,
  state = "later",
  className = "",
}: {
  date: string | Date;
  state?: "past" | "later" | "soon" | "today";
  className?: string;
}) {
  const d = typeof date === "string" ? parseUtc(date) : date;
  const month = d.toLocaleDateString(undefined, { month: "short" });
  const day = d.getDate();
  const palette =
    state === "today"
      ? "bg-lamp text-on-lamp border-ink-950"
      : state === "soon"
      ? "bg-ink-950 text-paper-50 border-ink-950"
      : state === "past"
      ? "bg-transparent text-ink-400 border-line border-dashed"
      : "bg-surface text-ink-900 border-ink-700";
  return (
    <div
      aria-hidden="true"
      className={`w-12 shrink-0 self-start text-center border-[1.5px] rounded-[var(--radius-control)] py-1 leading-none ${palette} ${className}`}
    >
      <div className="data !text-[10px] uppercase tracking-wider">{month}</div>
      <div className="font-display text-xl font-bold mt-0.5">{day}</div>
    </div>
  );
}
