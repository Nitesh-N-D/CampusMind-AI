import { Link } from "react-router-dom";
import { Wordmark } from "@/components/Brand";
import { Seal } from "@/components/Seal";
import { Button } from "@/components/ui";
import { ThemeToggle } from "@/components/ThemeToggle";

const FEATURES = [
  {
    title: "Source-Trust Engine",
    body: "Every document gets a transparent 0-100 confidence score built from officiality, verification, and recency - never presented as absolute truth.",
  },
  {
    title: "Temporal-aware retrieval",
    body: "CampusMind knows which academic year, semester, and version is currently valid, and quietly deprioritizes superseded material.",
  },
  {
    title: "Conflict detection",
    body: "When two official sources disagree, the assistant says so explicitly instead of silently picking a side.",
  },
  {
    title: "Personalized context",
    body: "Students set their department, year, and semester once - answers are ranked around what's actually relevant to them.",
  },
  {
    title: "Deadline intelligence",
    body: "Exam dates, fee deadlines, and placement windows are extracted straight from official circulars onto a live timeline.",
  },
  {
    title: "What changed?",
    body: "When a regulation is replaced, CampusMind diffs the old and new versions and explains the practical impact in one sentence.",
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-paper-100">
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
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <ThemeToggle />
            <Link to="/login" className="hidden sm:inline text-sm font-medium text-ink-800 hover:text-ink-950">
              Sign in
            </Link>
            <Link to="/register-college">
              <Button className="!py-2 !px-3 sm:!px-3.5 text-xs sm:text-sm whitespace-nowrap">
                <span className="hidden sm:inline">Set up your college</span>
                <span className="sm:hidden">Get started</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 pb-20 grid lg:grid-cols-2 gap-14 items-center">
        <div>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-violet-600 bg-violet-50 px-2.5 py-1 rounded-full">
            Grounded campus intelligence
          </span>
          <h1 className="font-display text-4xl sm:text-5xl leading-[1.1] text-ink-950 mt-5">
            Answers your college
            <br />
            can actually stand behind.
          </h1>
          <p className="text-ink-500 text-lg mt-5 max-w-lg">
            CampusMind AI reads your college's own regulations, circulars, and notices, then
            answers student questions with page-level citations and a visible trust score - never
            a guess dressed up as fact.
          </p>
          <div className="flex flex-wrap gap-3 mt-8">
            <Link to="/register-college">
              <Button className="text-base px-5 py-3">Create your college workspace</Button>
            </Link>
            <Link to="/register">
              <Button variant="secondary" className="text-base px-5 py-3">
                I'm a student
              </Button>
            </Link>
          </div>
          <p className="text-xs text-ink-400 mt-4">
            Free to run on open-source infrastructure. Official college email required.
          </p>
        </div>

        <div className="relative">
          <div className="bg-surface border border-line rounded-[var(--radius-card)] shadow-[var(--shadow-raised)] p-5 sm:p-6">
            <div className="flex items-center gap-2 pb-4 mb-4 border-b border-line">
              <div className="w-2 h-2 rounded-full bg-seal-coral-600" />
              <div className="w-2 h-2 rounded-full bg-seal-amber-600" />
              <div className="w-2 h-2 rounded-full bg-seal-teal-600" />
              <span className="ml-2 text-xs text-ink-400 font-medium" style={{ fontFamily: "var(--font-mono)" }}>
                ask-campusmind
              </span>
            </div>

            <div className="flex justify-end mb-4">
              <div className="bg-navy-700 text-paper-50 rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm max-w-[85%]">
                What's the minimum attendance requirement?
              </div>
            </div>

            <div className="bg-paper-100 border border-line rounded-2xl rounded-tl-sm px-4 py-3.5 text-sm text-ink-800 max-w-[92%]">
              <p>
                I found conflicting official information. The 2026-27 regulation states{" "}
                <strong className="font-medium">80%</strong>, superseding the 2025-26 regulation's{" "}
                <strong className="font-medium">75%</strong>. The newer document is suggested as
                authoritative, pending admin review.
              </p>
              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-line">
                <Seal score={85} level="very_high" size="sm" />
                <div className="text-xs">
                  <p className="font-medium text-ink-800">Attendance Regulations 2026-27</p>
                  <p className="text-ink-400">Page 1 - Section 5.2</p>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 text-xs text-seal-amber-900 bg-seal-amber-50 border border-seal-amber-100 rounded-[var(--radius-control)] px-3 py-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="M12 3 3 20h18L12 3Z" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M12 9.5v4.5M12 17h.01" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              Conflict flagged for admin review - not silently resolved
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-6xl mx-auto px-4 sm:px-6 py-20 border-t border-line">
        <div className="max-w-xl mb-12">
          <span className="text-xs font-medium uppercase tracking-wider text-violet-600">
            Built for how colleges actually work
          </span>
          <h2 className="font-display text-3xl text-ink-950 mt-2">
            Not a generic chatbot with a college logo on it.
          </h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-surface border border-line rounded-[var(--radius-card)] p-5">
              <h3 className="font-medium text-ink-900">{f.title}</h3>
              <p className="text-sm text-ink-500 mt-2 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="max-w-6xl mx-auto px-4 sm:px-6 py-20 border-t border-line">
        <h2 className="font-display text-3xl text-ink-950 mb-10">Three roles, one grounded knowledge base</h2>
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-8">
          {[
            {
              who: "College admin",
              body: "Creates a workspace, sets the official email domain, uploads and verifies documents, and resolves conflicts.",
            },
            {
              who: "Student",
              body: "Signs up with their official college email, sets department and year, and asks questions in plain language - in English, Tamil, or Hindi.",
            },
            {
              who: "Faculty",
              body: "Gets their own chat history and suggestions tuned for staff - circular summaries, curriculum changes, upcoming department deadlines.",
            },
            {
              who: "CampusMind AI",
              body: "Retrieves the right passage, scores its trust, checks for conflicts and outdated versions, then answers with citations attached.",
            },
          ].map((r) => (
            <div key={r.who}>
              <h3 className="font-display text-lg text-ink-900">{r.who}</h3>
              <p className="text-sm text-ink-500 mt-2 leading-relaxed">{r.body}</p>
            </div>
          ))}
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
          </nav>
          <p className="text-xs text-ink-400">
            Built by students, grounded in official sources. Not affiliated with any single institution.
          </p>
        </div>
      </footer>
    </div>
  );
}
