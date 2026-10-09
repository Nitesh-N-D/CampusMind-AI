import { useEffect, useState, type ReactNode } from "react";
import { AppShell } from "@/layouts/AppShell";
import { Button, ErrorBanner, Input, PageHeader, Select, Skeleton } from "@/components/ui";
import { api, ApiError, type Profile as ProfileType } from "@/lib/api";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ta", label: "Tamil" },
  { code: "hi", label: "Hindi" },
];

function validateFullName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Full name can't be empty.";
  if (trimmed.length > 120) return "Full name is too long.";
  if (/\d/.test(trimmed)) return "Full name shouldn't contain numbers.";
  return null;
}

function validateNickname(nickname: string): string | null {
  if (nickname === "") return null; // empty clears it, always valid
  if (nickname.trim().length < 2) return "Nickname must be at least 2 characters.";
  if (nickname.length > 60) return "Nickname is too long.";
  if (!/^[a-zA-Z0-9 _\-.]+$/.test(nickname)) {
    return "Nickname can only contain letters, numbers, spaces, - _ and .";
  }
  return null;
}

function ProfileSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-t border-line-strong pt-4">
      <h2 className="flex items-center gap-2.5 text-xl font-bold text-ink-950 mb-4">
        <span aria-hidden="true" className="w-2.5 h-2.5 rotate-45 bg-lamp outline outline-1 outline-ink-950 shrink-0" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function SavedMark({ show }: { show: boolean }) {
  return (
    <span role="status" className="text-sm font-semibold text-ink-950 inline-flex items-center gap-1.5 min-h-5">
      {show && (
        <>
          <span aria-hidden="true" className="text-[10px] bg-lamp text-on-lamp px-1 rounded-[var(--radius-chip)]">
            ◆
          </span>
          Saved
        </>
      )}
    </span>
  );
}

export default function Profile() {
  const [profile, setProfile] = useState<ProfileType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [identity, setIdentity] = useState({ full_name: "", nickname: "" });
  const [identityErrors, setIdentityErrors] = useState<{ full_name?: string; nickname?: string }>({});
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [identitySaved, setIdentitySaved] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [interestsInput, setInterestsInput] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await api.profile.me();
      setProfile(p);
      setIdentity({ full_name: p.full_name, nickname: p.nickname ?? "" });
      setInterestsInput(p.interests.join(", "));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load your profile.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const saveIdentity = async () => {
    const nameErr = validateFullName(identity.full_name);
    const nickErr = validateNickname(identity.nickname);
    if (nameErr || nickErr) {
      setIdentityErrors({ full_name: nameErr ?? undefined, nickname: nickErr ?? undefined });
      return;
    }
    setIdentityErrors({});
    setSavingIdentity(true);
    setIdentitySaved(false);
    try {
      const updated = await api.profile.update({
        full_name: identity.full_name.trim(),
        nickname: identity.nickname.trim(),
      });
      setProfile(updated);
      setIdentitySaved(true);
      setTimeout(() => setIdentitySaved(false), 2500);
    } catch (err) {
      setIdentityErrors({
        full_name:
          err instanceof ApiError ? err.message : "Couldn't save your name. Please try again.",
      });
    } finally {
      setSavingIdentity(false);
    }
  };

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      // Admins have no academic context - the API rejects those fields for them.
      const updated = await api.profile.update(
        profile.role === "admin"
          ? { preferred_language: profile.preferred_language }
          : {
              department: profile.department || undefined,
              year: profile.year ?? undefined,
              semester: profile.semester ?? undefined,
              section: profile.section || undefined,
              academic_batch: profile.academic_batch || undefined,
              interests: interestsInput
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
              preferred_language: profile.preferred_language,
            },
      );
      setProfile(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save your changes.");
    } finally {
      setSaving(false);
    }
  };

  const clearPersonalization = async () => {
    if (!confirm("Clear your department, year, semester, section, and interests? Your account stays active.")) return;
    try {
      await api.profile.remove();
      await load();
      setInterestsInput("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't clear your profile.");
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="mb-8">
          <Skeleton className="h-3 w-24 mb-3" />
          <Skeleton className="h-8 w-56 mb-2" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="grid gap-6 max-w-2xl">
          {[0, 1, 2].map((i) => (
            <div key={i} className="border-t border-line-strong pt-5">
              <Skeleton className="h-4 w-32 mb-5" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
              </div>
            </div>
          ))}
        </div>
      </AppShell>
    );
  }

  const isAdmin = profile?.role === "admin";

  const languageSelect = profile && (
    <Select
      label="Preferred response language"
      value={profile.preferred_language}
      onChange={(e) => setProfile({ ...profile, preferred_language: e.target.value })}
    >
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </Select>
  );

  const saveRow = (
    <div className="flex items-center gap-3 mt-6">
      <Button onClick={save} disabled={saving}>
        {saving ? "Saving..." : "Save changes"}
      </Button>
      <SavedMark show={saved} />
    </div>
  );

  return (
    <AppShell>
      <PageHeader
        eyebrow="Your account"
        title="Profile"
        description={
          isAdmin
            ? "Your name and preferences for this workspace."
            : "This context personalizes your answers - CampusMind AI prioritizes results relevant to your department and year."
        }
      />

      {error && (
        <div className="mb-6">
          <ErrorBanner message={error} onRetry={load} />
        </div>
      )}

      {profile && (
        <div className="grid grid-cols-1 gap-10 max-w-2xl">
          <div className="flex items-center gap-4">
            <span
              aria-hidden="true"
              className="w-14 h-14 shrink-0 flex items-center justify-center bg-lamp text-on-lamp text-xl font-bold rounded-[var(--radius-card)] border-[1.5px] border-ink-950"
            >
              {(profile.nickname || profile.full_name || "?").trim().charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="text-xl font-bold text-ink-950 truncate">{profile.full_name}</p>
              <p className="data text-ink-500 truncate">
                {profile.role} · {profile.email}
              </p>
            </div>
          </div>
          <ProfileSection title="Identity">

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Full name"
                value={identity.full_name}
                onChange={(e) => setIdentity((s) => ({ ...s, full_name: e.target.value }))}
                error={identityErrors.full_name}
              />
              <Input
                label="Nickname (optional)"
                placeholder="What should we call you?"
                value={identity.nickname}
                onChange={(e) => setIdentity((s) => ({ ...s, nickname: e.target.value }))}
                error={identityErrors.nickname}
              />
              <Input label="College email" value={profile.email} disabled />
              <Input label="Role" value={profile.role} disabled className="capitalize" />
            </div>
            <div className="flex items-center gap-3 mt-5">
              <Button onClick={saveIdentity} disabled={savingIdentity}>
                {savingIdentity ? "Saving..." : "Save identity"}
              </Button>
              <SavedMark show={identitySaved} />
            </div>
          </ProfileSection>

          {isAdmin ? (
            <ProfileSection title="Preferences">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{languageSelect}</div>
              {saveRow}
            </ProfileSection>
          ) : (
            <>
            <ProfileSection title="Academic context">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Department"
                  placeholder="CSE"
                  value={profile.department ?? ""}
                  onChange={(e) => setProfile({ ...profile, department: e.target.value })}
                />
                <Select
                  label="Year"
                  value={profile.year ?? ""}
                  onChange={(e) => setProfile({ ...profile, year: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">Not set</option>
                  {[1, 2, 3, 4, 5].map((y) => (
                    <option key={y} value={y}>
                      Year {y}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Semester"
                  value={profile.semester ?? ""}
                  onChange={(e) =>
                    setProfile({ ...profile, semester: e.target.value ? Number(e.target.value) : null })
                  }
                >
                  <option value="">Not set</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                    <option key={s} value={s}>
                      Sem {s}
                    </option>
                  ))}
                </Select>
                <Input
                  label="Section"
                  placeholder="A"
                  value={profile.section ?? ""}
                  onChange={(e) => setProfile({ ...profile, section: e.target.value })}
                />
                <Input
                  label="Academic batch"
                  placeholder="2024-2028"
                  value={profile.academic_batch ?? ""}
                  onChange={(e) => setProfile({ ...profile, academic_batch: e.target.value })}
                />
                {languageSelect}
              </div>
              <div className="mt-4">
                <Input
                  label="Interests (comma-separated)"
                  placeholder="AI, MLOps, Robotics"
                  value={interestsInput}
                  onChange={(e) => setInterestsInput(e.target.value)}
                />
              </div>
              {saveRow}
            </ProfileSection>

            <ProfileSection title="Privacy">
              <p className="text-sm text-ink-700 mb-4">
                You're always in control of your personalization data. Clearing it won't delete your
                account, conversation history, or name.
              </p>
              <Button variant="danger" onClick={clearPersonalization}>
                Clear academic context
              </Button>
            </ProfileSection>
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}
