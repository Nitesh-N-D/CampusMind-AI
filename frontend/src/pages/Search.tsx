import { useState, type FormEvent } from "react";
import { AppShell } from "@/layouts/AppShell";
import { PageHeader, ErrorBanner, EmptyState, SkeletonList } from "@/components/ui";
import { Seal, type TrustLevel } from "@/components/Seal";
import { api, ApiError, type SearchResult } from "@/lib/api";
import { confidenceLevel } from "./Chat";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const runSearch = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const res = await api.search(query.trim());
      setResults(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Search failed while querying the college knowledge base.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Campus search"
        title="Search the college knowledge base"
        description="Hybrid semantic and keyword search across every verified document - attendance, placements, fees, hostel rules, and more."
      />

      <form onSubmit={runSearch} className="flex gap-3 mb-8">
        <div className="relative flex-1">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400"
            aria-hidden="true"
          >
            <circle cx="10.5" cy="10.5" r="6.5" strokeWidth="1.6" />
            <path d="m20 20-4.3-4.3" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="attendance, placement registration, hostel fees, leave rules..."
            className="w-full h-12 pl-11 pr-4 rounded-[var(--radius-control)] border border-line-strong bg-surface text-sm outline-none focus:border-navy-700"
          />
        </div>
        <button
          type="submit"
          className="h-12 px-6 rounded-[var(--radius-control)] bg-navy-700 text-paper-50 text-sm font-medium hover:bg-navy-900 transition-colors"
        >
          Search
        </button>
      </form>

      {loading && <SkeletonList count={4} lines={2} />}

      {error && <ErrorBanner message={error} onRetry={runSearch} />}

      {!loading && searched && !error && results?.length === 0 && (
        <EmptyState
          title="No matching official documents"
          body="Try a shorter or more general phrase, or check back once the relevant document has been uploaded."
        />
      )}

      {!loading && results && results.length > 0 && (
        <div className="flex flex-col gap-3">
          {results.map((r, i) => (
            <div
              key={i}
              className="flex flex-col sm:flex-row gap-4 bg-surface border border-line rounded-[var(--radius-card)] p-5"
            >
              <Seal
                score={r.trust_score}
                level={confidenceLevel(r.trust_score) as TrustLevel}
                showLabel
                size="md"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h3 className="font-medium text-ink-900">{r.document_title}</h3>
                  {r.department && (
                    <span className="text-xs text-ink-400" style={{ fontFamily: "var(--font-mono)" }}>
                      {r.department}
                    </span>
                  )}
                  {r.page && (
                    <span className="text-xs text-ink-400" style={{ fontFamily: "var(--font-mono)" }}>
                      page {r.page}
                    </span>
                  )}
                </div>
                <p className="text-sm text-ink-500 mt-2 leading-relaxed">{r.snippet}</p>
                <p className="text-[11px] text-ink-400 mt-2" style={{ fontFamily: "var(--font-mono)" }}>
                  relevance {Math.round(r.relevance_score)}%
                  {r.date ? ` - updated ${new Date(r.date).toLocaleDateString()}` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {!searched && (
        <EmptyState
          title="Search across every official document"
          body="Results are ranked by relevance and trust together, so the most current and authoritative source always surfaces first."
        />
      )}
    </AppShell>
  );
}
