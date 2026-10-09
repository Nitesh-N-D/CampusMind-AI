import { Link } from "react-router-dom";
import { Wordmark } from "@/components/Brand";
import { AnswerBlock, QuestionLine } from "@/components/AnswerBlock";
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
    body: "PDF, Word, Excel, PowerPoint, CSV, plain text, and photos of printed notices. Scanned pages and images are read with text recognition.",
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
      <header className="border-b border-line bg-surface/90 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Wordmark className="text-sm sm:text-base shrink-0" />
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-ink-800">
            <a href="#features" className="hover:underline decoration-2 decoration-lamp underline-offset-8">
              Features
            </a>
            <a href="#how-it-works" className="hover:underline decoration-2 decoration-lamp underline-offset-8">
              How it works
            </a>
          </nav>
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <ThemeToggle compactOnMobile />
            <Link to="/login" className="text-sm font-semibold text-ink-900 hover:underline decoration-2 decoration-lamp underline-offset-4 px-2 min-h-10 inline-flex items-center">
              Sign in
            </Link>
            {/* The hero repeats this CTA, so phones skip it here to keep the header on one row. */}
            <Link to="/register-college" className="hidden sm:block">
              <Button className="!py-2 !px-3.5 text-sm whitespace-nowrap">Set up your college</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 sm:pt-16 pb-16 sm:pb-20 grid grid-cols-1 lg:grid-cols-[1fr_1.05fr] gap-12 lg:gap-16 items-center">
        <div className="min-w-0">
          <p className="label-caps">For colleges, students and faculty</p>
          <h1 className="font-bold text-4xl sm:text-5xl lg:text-6xl leading-[1.04] text-ink-950 mt-3">
            Ask your campus.{" "}
            <span className="bg-lamp text-on-lamp px-2 -mx-1 box-decoration-clone rounded-[var(--radius-chip)]">
              See where the answer comes from.
            </span>
          </h1>
          <p className="text-ink-700 text-base sm:text-lg mt-6 max-w-lg">
            CampusMind AI answers student and faculty questions using only your college's own regulations,
            circulars, and notices - with a citation and a visible trust level on every answer.
          </p>
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 mt-8">
            <Link to="/register-college">
              <Button className="w-full sm:w-auto text-base px-6 py-3">Create your college workspace</Button>
            </Link>
            <Link to="/register">
              <Button variant="secondary" className="w-full sm:w-auto text-base px-6 py-3">
                Join as a student or faculty
              </Button>
            </Link>
          </div>
          <p className="text-xs text-ink-500 mt-4">
            Sign-up requires an official college email address on a domain your admin has approved.
          </p>
        </div>

        {/* The product itself: the same components Chat renders. */}
        <figure className="min-w-0">
          <div className="bg-surface border-[1.5px] border-ink-950 rounded-[var(--radius-card)] p-4 sm:p-6 space-y-5 shadow-[8px_8px_0_var(--color-lamp)]">
            <QuestionLine>What's the minimum attendance requirement?</QuestionLine>
            <AnswerBlock
              answer="The 2026-27 regulation states 80% and replaces the 75% in the 2025-26 regulation, so the newer figure applies."
              trust="high"
              score={86}
              conflicts={[
                {
                  topic: "minimum attendance",
                  value_a: "75% of classes attended",
                  value_b: "80% of classes attended",
                  reasoning: "The later regulation supersedes the earlier one.",
                  current: "b",
                },
              ]}
              sources={[
                {
                  title: "Attendance Regulations 2026-27",
                  page: 1,
                  version: 2,
                  status: "current",
                  trustScore: 86,
                  trustLevel: "high",
                },
                {
                  title: "Attendance Regulations 2025-26",
                  page: 1,
                  version: 1,
                  status: "archived",
                  trustScore: 54,
                  trustLevel: "medium",
                },
              ]}
            />
          </div>
          <figcaption className="text-xs text-ink-500 mt-5 text-center">
            Illustrative example using fictional documents.
          </figcaption>
        </figure>
      </section>

      {/* Features */}
      <section id="features" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 border-t border-line">
        <div className="max-w-xl mb-10 sm:mb-12">
          <p className="label-caps">What it does</p>
          <h2 className="font-bold text-3xl sm:text-4xl text-ink-950 mt-2 leading-tight">
            One focused assistant, built on your official documents.
          </h2>
        </div>
        <ol className="grid grid-cols-1 md:grid-cols-2 gap-x-14">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex gap-4 py-5 border-t border-line-strong">
              <span aria-hidden="true" className="mt-2 w-3 h-3 rotate-45 bg-lamp outline outline-1 outline-ink-950 shrink-0" />
              <div>
                <h3 className="text-xl font-semibold text-ink-950">{f.title}</h3>
                <p className="text-sm text-ink-700 mt-1.5 leading-relaxed">{f.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 border-t border-line">
        <h2 className="font-bold text-3xl sm:text-4xl text-ink-950 mb-8 sm:mb-10">Who does what</h2>
        <div className="grid md:grid-cols-3 gap-x-8 gap-y-8">
          {ROLES.map((r) => (
            <div key={r.who} className="border-t-4 border-ink-950 pt-4">
              <h3 className="text-xl font-semibold text-ink-950">{r.who}</h3>
              <p className="text-sm text-ink-700 mt-2 leading-relaxed">{r.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-14 border-[1.5px] border-seal-amber-600 bg-seal-amber-50 rounded-[var(--radius-card)] px-6 py-5">
          <h3 className="text-xl font-semibold text-ink-950">What it won't do</h3>
          <ul className="mt-3 space-y-2">
            {LIMITS.map((l) => (
              <li key={l} className="flex gap-2.5 text-sm text-ink-800 leading-relaxed">
                <span className="mt-2 w-1.5 h-1.5 bg-ink-950 shrink-0" aria-hidden="true" />
                {l}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <Wordmark className="text-sm" />
          <nav className="flex items-center gap-5 text-sm text-ink-700">
            <Link to="/privacy" className="min-h-10 inline-flex items-center hover:text-ink-950 hover:underline">
              Privacy
            </Link>
            <Link to="/terms" className="min-h-10 inline-flex items-center hover:text-ink-950 hover:underline">
              Terms
            </Link>
            <Link to="/login" className="min-h-10 inline-flex items-center hover:text-ink-950 hover:underline">
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
