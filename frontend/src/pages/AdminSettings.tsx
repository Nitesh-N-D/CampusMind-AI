import { useEffect, useState } from "react";
import { AppShell } from "@/layouts/AppShell";
import { Badge, Button, Card, ErrorBanner, Input, PageHeader, Skeleton, Spinner } from "@/components/ui";
import { api, ApiError, type WorkspaceSettings } from "@/lib/api";
import { toastSuccess } from "@/lib/toastStore";

export default function AdminSettings() {
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [facultyDomain, setFacultyDomain] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const s = await api.admin.settings();
      setSettings(s);
      setFacultyDomain(s.faculty_domain ?? "");
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Couldn't load workspace settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (value: string | null) => {
    setSaving(true);
    setSaveError(null);
    try {
      const s = await api.admin.setFacultyDomain(value);
      setSettings(s);
      setFacultyDomain(s.faculty_domain ?? "");
      toastSuccess(s.faculty_domain ? "Faculty domain saved. Faculty signup is open." : "Faculty signup closed.");
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save the faculty domain.");
    } finally {
      setSaving(false);
    }
  };

  const submitDomain = () => {
    const value = facultyDomain.trim();
    if (!value) {
      setSaveError("Enter a faculty email domain, or use \"Close faculty signup\" to clear it.");
      return;
    }
    save(value);
  };

  const current = settings?.faculty_domain ?? null;
  const unchanged = facultyDomain.trim().toLowerCase().replace(/^@/, "") === (current ?? "");

  return (
    <AppShell>
      <PageHeader
        eyebrow="Admin"
        title="Workspace settings"
        description="Controls who can sign up to your college's workspace. Only admins can see or change these."
      />

      {loadError && <ErrorBanner message={loadError} onRetry={load} />}

      {loading && (
        <div className="grid gap-6 max-w-2xl">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      )}

      {!loading && settings && (
        <div className="grid gap-6 max-w-2xl">
          <Card className="p-6">
            <h2 className="font-medium text-ink-900">Student signup</h2>
            <p className="text-sm text-ink-500 mt-1">
              Students sign up with an address on your official domain. This was set when the workspace was created.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink-500">Official domain</span>
              <code className="px-2 py-1 rounded bg-paper-200 text-ink-900" style={{ fontFamily: "var(--font-mono)" }}>
                @{settings.official_domain}
              </code>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium text-ink-900">Faculty signup</h2>
              {current ? <Badge tone="teal">Open</Badge> : <Badge tone="amber">Closed</Badge>}
            </div>
            <p className="text-sm text-ink-500 mt-1">
              Faculty sign up only with an address on the faculty domain you set here. Until one is set, faculty
              signup is closed - the official domain is never used for faculty.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitDomain();
              }}
              className="mt-5 flex flex-col gap-4">
              {saveError && <ErrorBanner message={saveError} />}
              <Input
                id="faculty_domain"
                label="Faculty email domain"
                placeholder={`faculty.${settings.official_domain}`}
                hint="For example, if faculty emails look like jane@staff.yourcollege.edu, enter staff.yourcollege.edu."
                value={facultyDomain}
                onChange={(e) => setFacultyDomain(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={saving || unchanged}>
                  {saving && <Spinner />}
                  {current ? "Update faculty domain" : "Open faculty signup"}
                </Button>
                {current && (
                  <Button type="button" variant="ghost" disabled={saving} onClick={() => save(null)}>
                    Close faculty signup
                  </Button>
                )}
              </div>
              <p className="text-xs text-ink-400">
                Changing or clearing the domain only affects new signups. Existing faculty accounts keep working.
              </p>
            </form>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
