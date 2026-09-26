import { LegalLayout } from "@/layouts/LegalLayout";

export default function Privacy() {
  return (
    <LegalLayout title="Privacy Policy" updated="September 2026">
      <p>
        CampusMind AI is self-hosted software: each college workspace runs on infrastructure
        chosen and operated by that college's own administrators, not by a single central
        company. This policy describes how the CampusMind AI software itself handles data.
        Your specific college may add its own terms on top of this - check with your admin if
        you're unsure who operates your workspace's servers.
      </p>

      <section>
        <h2 className="font-display text-lg text-ink-900 mb-2">What we collect</h2>
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>
            <strong>Account information:</strong> your name, college email address, and a
            securely hashed password (bcrypt - your actual password is never stored or
            visible to anyone, including admins).
          </li>
          <li>
            <strong>Personalization data (optional):</strong> department, year, semester,
            section, and interests, if you choose to add them on your Profile page. This is
            never required to use the assistant.
          </li>
          <li>
            <strong>Chat history:</strong> the questions you ask and the answers CampusMind AI
            gives, stored so you can revisit past conversations.
          </li>
          <li>
            <strong>Question analytics:</strong> the text of each question is logged with a
            confidence score. Admins see these only in aggregate - the most-asked and
            poorly answered questions, without names attached - to find gaps in the
            knowledge base.
          </li>
          <li>
            <strong>Sign-in activity:</strong> each successful sign-in and registration is
            recorded with your name, email address, role, and the time. Your college's admins
            can view this log.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="font-display text-lg text-ink-900 mb-2">What we don't do</h2>
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>We don't sell or share your data with advertisers - there are no ads in CampusMind AI.</li>
          <li>We don't use your questions to train any third-party model beyond what your
            configured AI provider (e.g. Google Gemini) does with API requests generally -
            see that provider's own data policy for specifics.</li>
          <li>We don't show your personalization data to other students or faculty.</li>
        </ul>
      </section>

      <section>
        <h2 className="font-display text-lg text-ink-900 mb-2">Who can see what</h2>
        <p>
          Your college workspace is isolated from every other college on the platform - a
          different college's admins and students cannot see your data, your documents, or
          your questions. Within your own college, your chat history and personalization
          details are visible only to you. College admins can see aggregate analytics
          (e.g. "how many questions were asked this month") and the sign-in log described
          above, but not your individual conversations, unless they use the "report
          incorrect answer" feedback you explicitly submit.
        </p>
      </section>

      <section>
        <h2 className="font-display text-lg text-ink-900 mb-2">Your controls</h2>
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>Edit or clear your personalization data any time from the Profile page.</li>
          <li>Delete individual chat sessions from the Chat page.</li>
          <li>Contact your college admin to request full account deletion.</li>
        </ul>
      </section>

      <section>
        <h2 className="font-display text-lg text-ink-900 mb-2">Third-party AI providers</h2>
        <p>
          When you ask a question, the relevant document excerpts and your question are sent
          to whichever AI provider your college admin has configured (Google Gemini, OpenAI,
          or Anthropic) to generate an answer. No API keys or account credentials are ever
          sent - only the text needed to answer your question.
        </p>
      </section>

      <section>
        <h2 className="font-display text-lg text-ink-900 mb-2">Questions</h2>
        <p>
          For questions about how your specific college's CampusMind AI workspace handles
          data, contact your college's admin directly - they operate and control your
          workspace's data.
        </p>
      </section>
    </LegalLayout>
  );
}
