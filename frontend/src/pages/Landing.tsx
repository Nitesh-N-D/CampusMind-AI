import { Link } from "react-router-dom";
import { Wordmark } from "@/components/Brand";
import { Seal } from "@/components/Seal";
import { Button } from "@/components/ui";
import { ThemeToggle } from "@/components/ThemeToggle";

// Everything listed here is implemented and shipped - keep it that way.
const FEATURES = [
  {
    title: "Cited answers only",
    body: "Every answer links to the document and the page or section it came from. If nothing uploaded covers the question, the assistant says so instead of guessing.",
  },
  {
    title: "Source trust scores",
    body: "Each document gets a transparent 0-100 score built from officiality, admin verification, and recency, shown next to every citation.",
  },
  {
    title: "Conflict detection",
    body: "When two official documents disagree, the answer says so explicitly, and the conflict is listed for an admin to resolve.",
  },
  {
    title: "Current versions first",
    body: "Uploading a new version of a document supersedes the old one, and answers favour the academic year and version that is currently valid.",
  },
  {
    title: "Any official format",
    body: "PDF, Word, Excel, CSV, plain text, and photos of printed notices. Scanned pages and images are read with text recognition.",
  },
  {
    title: "English, Tamil, and Hindi",
    body: "When the workspace is connected to an AI model, students and faculty can choose the language of the answer. Citations always point back to the original document.",
  },
];

const ROLES = [
  {
    who: "College admin",
    body: "Creates the workspace, sets the student and faculty email domains, uploads and verifies documents, resolves conflicts, and can review student and faculty sign-in activity.",
  },
  {
    who: "Students",
    body: "Sign up with their official college email, set department and year once, and ask questions in plain language.",
  },
  {
    who: "Faculty",
    body: "Sign up with the faculty email domain the admin has configured, and get suggestions suited to staff - regulations, circulars, exam schedules.",
  },
];

const LIMITS = [
  "It only knows what your college has uploaded. It does not browse the web.",
  "Trust scores and conflict flags help people judge a source - they are not a guarantee.",
  "It does not replace your college's official notices; always check the cited document before acting on a deadline.",
];

export default function Landing() {
  return (
    <div className="min-h-dvh bg-paper-100">
      <header className="border-b border-line bg-paper-50/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Wordmark className="text-sm sm:text-base shrink-0" />
          <nav className="hidden md:flex items-center gap-6 text-sm text-ink-700">
            <a href="#features" className="hover:text-ink-950">
              Features
            </a>
            <a href="#how-it-works" className="hover:text-ink-950">
              How it works
            </a>
          </nav>
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <ThemeToggle />
            <Link to="/login" className="text-sm font-medium text-ink-800 hover:text-ink-950 px-2">
              Sign in
            </Link>
            <Link to="/register-college">
              <Button className="!py-2 !px-3 sm:!px-3.5 text-xs sm:text-sm whitespace-nowrap">
                <span className="hidden sm:inline">Set up your college</span>
                <span className="sm:hidden">Set up</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 sm:pt-16 pb-16 sm:pb-20 grid lg:grid-cols-2 gap-12 lg:gap-14 items-center">
        <div>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-violet-600 bg-violet-50 px-2.5 py-1 rounded-full">
            Grounded campus assistant
          </span>
          <h1 className="font-display text-4xl sm:text-5xl leading-[1.1] text-ink-950 mt-5">
            Answers your college
            <br className="hidden sm:block" /> can actually stand behind.
          </h1>
          <p className="text-ink-500 text-base sm:text-lg mt-5 max-w-lg">
            CampusMind AI answers student and faculty questions using only your college's own regulations,
            circulars, and notices - with a citation and a visible trust score on every answer.
          </p>
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 mt-8">
            <Link to="/register-college">
              <Button className="w-full sm:w-auto text-base px-5 py-3">Create your college workspace</Button>
            </Link>
            <Link to="/register">
              <Button variant="secondary" className="w-full sm:w-auto text-base px-5 py-3">
                Join as a student or faculty
              </Button>
            </Link>
          </div>
          <p className="text-xs text-ink-500 mt-4">
            Sign-up requires an official college email address on a domain your admin has approved.
          </p>
        </div>

        <figure className="relative">
          <div className="bg-surface border border-line rounded-[var(--radius-card)] shadow-[var(--shadow-raised)] p-5 sm:p-6">
            <div className="flex justify-end mb-4">
              <div className="bg-navy-700 text-on-navy rounded-2xl rounded-br-md px-4 py-2.5 text-sm max-w-[85%]">
                What's the minimum attendance requirement?
              </div>
            </div>

            <div className="text-sm text-ink-900 leading-relaxed">
              <p>
                The two official regulations disagree. The 2026-27 regulation states{" "}
                <strong className="font-medium">80%</strong> and supersedes the 2025-26 regulation's{" "}
                <strong className="font-medium">75%</strong>, so the newer figure applies.
              </p>
              <div className="flex items-center gap-3 mt-4 border border-line rounded-[var(--radius-control)] px-3 py-2.5">
                <Seal score={85} level="very_high" size="sm" />
                <div className="text-xs min-w-0">
                  <p className="font-medium text-ink-800 truncate">Attendance Regulations 2026-27</p>
                  <p className="text-ink-500" style={{ fontFamily: "var(--font-mono)" }}>
                    Page 1
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2 text-xs text-seal-amber-900 bg-seal-amber-50 border border-seal-amber-100 rounded-[var(--radius-control)] px-3 py-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="M12 3 3 20h18L12 3Z" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M12 9.5v4.5M12 17h.01" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              Conflict flagged for admin review - not silently resolved
            </div>
          </div>
          <figcaption className="text-xs text-ink-500 mt-3 text-center">
            Illustrative example using fictional documents.
          </figcaption>
        </figure>
      </section>

      {/* Features */}
      <section id="features" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 border-t border-line">
        <div className="max-w-xl mb-10 sm:mb-12">
          <span className="text-xs font-medium uppercase tracking-wider text-violet-600">What it does</span>
          <h2 className="font-display text-2xl sm:text-3xl text-ink-950 mt-2">
            One focused assistant, built on your official documents.
          </h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-surface border border-line rounded-[var(--radius-card)] p-5">
              <h3 className="font-medium text-ink-900">{f.title}</h3>
              <p className="text-sm text-ink-500 mt-2 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 border-t border-line">
        <h2 className="font-display text-2xl sm:text-3xl text-ink-950 mb-8 sm:mb-10">Who does what</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {ROLES.map((r) => (
            <div key={r.who}>
              <h3 className="font-display text-lg text-ink-900">{r.who}</h3>
              <p className="text-sm text-ink-500 mt-2 leading-relaxed">{r.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-14 bg-surface border border-line rounded-[var(--radius-card)] p-5 sm:p-6">
          <h3 className="font-medium text-ink-900">What it won't do</h3>
          <ul className="mt-3 space-y-2">
            {LIMITS.map((l) => (
              <li key={l} className="flex gap-2.5 text-sm text-ink-500 leading-relaxed">
                <span className="mt-2 w-1.5 h-1.5 rounded-full bg-ink-400 shrink-0" aria-hidden="true" />
                {l}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <Wordmark className="text-sm" />
          <nav className="flex items-center gap-5 text-xs text-ink-500">
            <Link to="/privacy" className="hover:text-ink-950">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-ink-950">
              Terms
            </Link>
            <Link to="/login" className="hover:text-ink-950">
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
