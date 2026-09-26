import { useState, type SubmitEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout } from "@/layouts/AuthLayout";
import { Button, ErrorBanner, Input, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/lib/authStore";

export default function RegisterCollege() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [form, setForm] = useState({
    college_name: "",
    official_domain: "",
    admin_full_name: "",
    admin_email: "",
    admin_password: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (form.admin_password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      const session = await api.auth.registerCollege(form);
      setSession(session);
      navigate("/admin");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the workspace. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Set up your college"
      subtitle="Create a private CampusMind AI workspace for your institution"
      footer={
        <>
          Already have a workspace?{" "}
          <Link to="/login" className="text-violet-600 font-medium hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <Input
          id="college_name"
          label="College name"
          placeholder="Madras Institute of Technology"
          required
          value={form.college_name}
          onChange={update("college_name")}
        />
        <Input
          id="official_domain"
          label="Official email domain"
          placeholder="mitindia.edu"
          hint="Only emails on this domain will be able to sign up for your chatbot."
          required
          value={form.official_domain}
          onChange={update("official_domain")}
        />
        <div className="h-px bg-line my-1" />
        <Input
          id="admin_full_name"
          label="Your full name"
          placeholder="Dr. Jane Doe"
          required
          value={form.admin_full_name}
          onChange={update("admin_full_name")}
        />
        <Input
          id="admin_email"
          type="email"
          label="Your admin email"
          placeholder={`you@${form.official_domain || "yourcollege.edu"}`}
          hint="Must match the official domain above."
          required
          value={form.admin_email}
          onChange={update("admin_email")}
        />
        <Input
          id="admin_password"
          type="password"
          label="Password"
          placeholder="At least 8 characters"
          required
          value={form.admin_password}
          onChange={update("admin_password")}
        />
        <Button type="submit" disabled={loading} className="mt-2">
          {loading && <Spinner />}
          {loading ? "Creating workspace..." : "Create workspace"}
        </Button>
      </form>
    </AuthLayout>
  );
}
