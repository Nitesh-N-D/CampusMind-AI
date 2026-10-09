import { usePageMeta } from "@/lib/usePageMeta";
import { Link } from "react-router-dom";
import { Wordmark } from "@/components/Brand";
import { BackLink } from "@/components/BackLink";

export default function NotFound() {
  usePageMeta({ title: "Page not found", noindex: true, noCanonical: true });
  return (
    <div className="min-h-dvh bg-paper-100">
      <header className="border-b border-line bg-surface">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center">
          <Link to="/">
            <Wordmark className="text-sm sm:text-base" />
          </Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-4 pb-16">
        <BackLink />
        <div className="mt-10">
          <p aria-hidden="true" className="data text-ink-950 text-6xl sm:text-7xl font-semibold leading-none tracking-tight">
            404<span className="inline-block w-3 h-3 ml-2 rotate-45 bg-lamp outline outline-1 outline-ink-950 align-middle" />
          </p>
          <span className="label-caps block mt-5">Error 404 · Source not found</span>
          <h1 className="text-3xl font-bold text-ink-950 mt-2">That page isn't in the knowledge base</h1>
          <p className="text-ink-700 mt-3 max-w-md">
            The page you're looking for doesn't exist or may have moved. Check the address, or go back to where
            you were.
          </p>
          <p className="mt-6 text-sm text-ink-500">
            Or start from the{" "}
            <Link to="/" className="text-violet-600 font-semibold underline decoration-2 underline-offset-4">
              CampusMind home page
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
