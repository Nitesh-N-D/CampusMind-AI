import { Link } from "react-router-dom";
import { Wordmark } from "@/components/Brand";
import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-paper-100 flex flex-col items-center justify-center px-6 text-center">
      <Wordmark className="mb-8" />
      <span className="font-display text-6xl text-ink-950">404</span>
      <h1 className="font-display text-xl text-ink-900 mt-3">This page isn't in the knowledge base</h1>
      <p className="text-sm text-ink-500 mt-2 max-w-sm">
        The page you're looking for doesn't exist or may have moved.
      </p>
      <Link to="/" className="mt-6">
        <Button>Back to home</Button>
      </Link>
    </div>
  );
}
