import { LegalLayout } from "@/layouts/LegalLayout";

export default function Terms() {
  return (
    <LegalLayout title="Terms of Service" updated="August 2026">
      <p>
        These terms cover use of the CampusMind AI software. Because each college workspace is
        self-hosted by that college's own administrators, your college may layer additional
        terms on top of these - this page describes how the software itself is meant to be used.
      </p>

      <section>
        <h2 className="font-display text-lg text-ink-900 mb-2">Eligibility</h2>
        <p>
          Access to a college's CampusMind AI workspace is restricted to people with a valid
          email address on that college's official domain, as configured by that college's
          admin. Creating an account under a domain you're not actually affiliated with is not
          permitted.
        </p>
      </section>

      <section>
        <h2 className="font-display text-lg text-ink-900 mb-2">What CampusMind AI is - and isn't</h2>
        <p>
          CampusMind AI answers questions using documents your college's admin has uploaded. It
          is a retrieval-and-summarization tool, not a source of truth in its own right - every
          answer is grounded in a cited document, and a visible trust/confidence score reflects
          the system's own assessment of that document's officiality and recency, not a
          guarantee of correctness. When sources conflict or no relevant document exists,
          CampusMind AI is designed to say so rather than guess.
        </p>
        <p className="mt-2">
          <strong>Always verify time-sensitive or high-stakes information</strong> (deadlines,
          eligibility criteria, fees) against your college's official channels before acting on
          it, especially if a conflict banner appears.
        </p>
      </section>

      <section>
        <h2 className="font-display text-lg text-ink-900 mb-2">Acceptable use</h2>
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>Don't attempt to access another user's account or another college's workspace.</li>
          <li>Don't upload documents you don't have the right to share (admins only).</li>
          <li>Don't use the assistant to generate content intended to mislead other students or
            staff about official college policy.</li>
          <li>Don't attempt to probe, disrupt, or reverse-engineer the underlying AI provider
            through the chat interface.</li>
        </ul>
      </section>

      <section>
        <h2 className="font-display text-lg text-ink-900 mb-2">Admin responsibilities</h2>
        <p>
          College admins are responsible for the accuracy of documents they upload and verify,
          for setting the correct official email domain, and for reviewing conflicts flagged by
          the system in a timely way. Marking a document "verified" is an admin's attestation
          that it reflects current official policy.
        </p>
      </section>

      <section>
        <h2 className="font-display text-lg text-ink-900 mb-2">No warranty</h2>
        <p>
          CampusMind AI is provided as-is. Trust scores, confidence percentages, and AI-generated
          summaries are system-generated estimates, not certified facts. Neither the software
          nor its output should be treated as legal, medical, financial, or official
          administrative advice.
        </p>
      </section>

      <section>
        <h2 className="font-display text-lg text-ink-900 mb-2">Changes</h2>
        <p>
          Your college admin may update these terms or the underlying software at any time. This
          page reflects the CampusMind AI software's default terms as of the date above.
        </p>
      </section>
    </LegalLayout>
  );
}
