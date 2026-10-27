import { useState, type ReactNode } from "react";
import { MarkIcon } from "@/components/Brand";
import { TrustMeter, type TrustLevel } from "@/components/Seal";
import { SourceRow, Supersession, type DocStatus } from "@/components/campus";

export interface AnswerSource {
  title: string;
  page?: number | null;
  section?: string | null;
  department?: string | null;
  version?: number | null;
  date?: string | null;
  status?: DocStatus;
  trustScore?: number;
  trustLevel?: TrustLevel;
}

export interface AnswerConflict {
  topic: string;
  value_a: string;
  value_b: string;
  reasoning: string;
  /** Which side holds today, when known. */
  current?: "a" | "b";
}

/** Sources shown before the list is expanded. */
export const COLLAPSED_SOURCE_COUNT = 2;

/** The sources to render: all of them when there are few or the list is open,
 *  otherwise only the first COLLAPSED_SOURCE_COUNT. Presentation only. */
export function visibleSources<T>(sources: T[], expanded: boolean): T[] {
  return expanded || sources.length <= COLLAPSED_SOURCE_COUNT ? sources : sources.slice(0, COLLAPSED_SOURCE_COUNT);
}

/** Maps the model's 0-100 confidence onto the four trust tiers. */
export function trustFromConfidence(confidence: number | null | undefined, abstained?: boolean): TrustLevel {
  if (abstained || typeof confidence !== "number") return "none";
  if (confidence >= 85) return "very_high";
  if (confidence >= 65) return "high";
  if (confidence >= 40) return "medium";
  return "low";
}

/** One question, drawn as a node on the thread with the question as a heading. */
export function QuestionLine({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="thread-node mt-0.5">
        <span className="block w-3.5 h-3.5 bg-ink-950 rotate-45" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="label-caps">You asked</p>
        <p className="font-display text-lg sm:text-xl font-semibold text-ink-950 leading-snug whitespace-pre-wrap break-words">
          {children}
        </p>
      </div>
    </div>
  );
}

/**
 * The CampusMind answer, in a fixed order the reader learns once:
 *   what it says  ->  how far to trust it  ->  where sources disagree  ->
 *   which campus documents it comes from  ->  what to do next (children).
 * A dashed thread joins these parts to the mark, so every claim visibly
 * hangs from its sources.
 */
export function AnswerBlock({
  answer,
  trust,
  score,
  sources = [],
  conflicts = [],
  note,
  sourcesLabel = "From these campus documents",
  trustHeading = "Trust",
  seeMoreLabel = "See more",
  seeLessLabel = "See less",
  children,
}: {
  answer: ReactNode;
  trust: TrustLevel;
  score?: number | null;
  sources?: AnswerSource[];
  conflicts?: AnswerConflict[];
  /** Caution shown directly under the answer (low confidence, no evidence). */
  note?: string;
  sourcesLabel?: string;
  trustHeading?: string;
  seeMoreLabel?: string;
  seeLessLabel?: string;
  children?: ReactNode;
}) {
  // Each answer is its own component instance, so expansion is per answer.
  const [expanded, setExpanded] = useState(false);
  const collapsible = sources.length > COLLAPSED_SOURCE_COUNT;
  return (
    <article className="thread flex gap-3 animate-rise">
      <span className="thread-node mt-0.5 z-[1] bg-paper-100">
        <MarkIcon size={22} />
      </span>
      <div className="min-w-0 flex-1 pb-1">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="label-caps">CampusMind answered</p>
          {/* No evidence-backed answer, no trust rating to show. */}
          {trust !== "none" && (
            <div className="flex items-center gap-2">
              <span className="label-caps">{trustHeading}</span>
              <TrustMeter level={trust} score={score ?? undefined} size="sm" showLabel showScore={false} />
            </div>
          )}
        </div>

        <div className="mt-2 text-[15px] sm:text-base text-ink-900 leading-relaxed whitespace-pre-wrap break-words">
          {answer}
        </div>

        {note && (
          <p
            role="note"
            className="mt-3 text-sm text-seal-amber-900 bg-seal-amber-50 border-[1.5px] border-seal-amber-600/60 rounded-[var(--radius-control)] px-3.5 py-2.5"
          >
            {note}
          </p>
        )}

        {conflicts.length > 0 && (
          <div className="mt-4 space-y-3">
            {conflicts.map((c, i) => (
              <Supersession
                key={i}
                topic={c.topic}
                reasoning={c.reasoning}
                lanes={[
                  { tag: "Version A", value: c.value_a, current: c.current === "a" },
                  { tag: "Version B", value: c.value_b, current: c.current === "b" },
                ]}
              />
            ))}
          </div>
        )}

        {sources.length > 0 && (
          <div className="mt-4">
            <p className="label-caps border-b border-line-strong pb-1.5">
              {sourcesLabel} <span className="data">({sources.length})</span>
            </p>
            <ol className="divide-y divide-line">
              {visibleSources(sources, expanded).map((s, i) => (
                <SourceRow key={i} index={i + 1} {...s} />
              ))}
            </ol>
            {collapsible && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="mt-2 text-sm font-medium text-ink-700 underline underline-offset-2 hover:text-ink-900"
              >
                {expanded ? seeLessLabel : seeMoreLabel}
              </button>
            )}
          </div>
        )}

        {children}
      </div>
    </article>
  );
}
