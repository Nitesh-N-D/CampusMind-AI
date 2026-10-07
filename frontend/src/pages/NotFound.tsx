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
        <div className="mt-10 border-l-4 border-violet-500 pl-5">
          <span className="label-caps">Error 404 · Not in the knowledge base</span>
          <h1 className="font-display text-3xl text-ink-950 mt-2">That page isn't in the knowledge base</h1>
          <p className="text-ink-500 mt-3 max-w-md">
            The page you're looking for doesn't exist or may have moved. Check the address, or go back to where
            you were.
          </p>
          <p className="mt-6 text-sm text-ink-500">
            Or start from the{" "}
            <Link to="/" className="text-violet-600 font-medium underline underline-offset-2">
              CampusMind home page
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
