import { useState, type SubmitEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout } from "@/layouts/AuthLayout";
import { Button, ErrorBanner, Input, Select, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/lib/authStore";

type Role = "student" | "faculty";

export default function RegisterStudent() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [role, setRole] = useState<Role>("student");
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    department: "",
    year: "",
    semester: "",
    section: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      const session = await api.auth.registerStudent({
        full_name: form.full_name,
        email: form.email,
        password: form.password,
        role,
        department: form.department || undefined,
        year: role === "student" && form.year ? Number(form.year) : undefined,
        semester: role === "student" && form.semester ? Number(form.semester) : undefined,
        section: role === "student" && form.section ? form.section : undefined,
      });
      setSession(session);
      navigate("/chat");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create your account. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title={role === "faculty" ? "Create your faculty account" : "Create your student account"}
      subtitle="Use your official college email address to unlock your college's assistant"
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="text-violet-600 font-medium hover:underline">
            Sign in
          </Link>{" "}
          or{" "}
          <Link to="/register-college" className="text-violet-600 font-medium hover:underline">
            set up your college
          </Link>
        </>
      }
    >
      <div className="flex gap-1 bg-paper-200 p-1 rounded-[var(--radius-control)] mb-6">
        {(["student", "faculty"] as Role[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            className={`flex-1 py-2 text-sm rounded-[6px] capitalize transition-colors ${
              role === r ? "bg-surface text-ink-950 font-medium shadow-sm" : "text-ink-500"
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <Input
          id="full_name"
          label="Full name"
          placeholder={role === "faculty" ? "Dr. Jane Doe" : "Vijay Sethupathi"}
          required
          value={form.full_name}
          onChange={update("full_name")}
        />
        <Input
          id="email"
          type="email"
          label={role === "faculty" ? "Faculty email" : "College email"}
          placeholder={role === "faculty" ? "you@faculty.yourcollege.edu" : "you@yourcollege.edu"}
          hint={
            role === "faculty"
              ? "Use your official faculty email address. Faculty signup opens once your college admin has added a faculty domain."
              : "Your college admin must have already set up their workspace with this domain."
          }
          required
          value={form.email}
          onChange={update("email")}
        />
        <Input
          id="password"
          type="password"
          label="Password"
          placeholder="At least 8 characters"
          required
          value={form.password}
          onChange={update("password")}
        />
        <div className="h-px bg-line my-1" />
        <p className="text-xs font-medium text-ink-500 uppercase tracking-wide">
          Optional - personalizes your answers
        </p>
        {role === "student" ? (
          <div className="grid grid-cols-2 gap-3">
            <Input
              id="department"
              label="Department"
              placeholder="CSE"
              value={form.department}
              onChange={update("department")}
            />
            <Select id="year" label="Year" value={form.year} onChange={update("year")}>
              <option value="">Select</option>
              {[1, 2, 3, 4, 5].map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </Select>
            <Select id="semester" label="Semester" value={form.semester} onChange={update("semester")}>
              <option value="">Select</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                <option key={s} value={s}>
                  Sem {s}
                </option>
              ))}
            </Select>
            <Input
              id="section"
              label="Section"
              placeholder="A"
              value={form.section}
              onChange={update("section")}
            />
          </div>
        ) : (
          <Input
            id="department"
            label="Department"
            placeholder="Computer Science and Engineering"
            value={form.department}
            onChange={update("department")}
          />
        )}
        <Button type="submit" disabled={loading} className="mt-2">
          {loading && <Spinner />}
          {loading ? "Creating account..." : "Create account"}
        </Button>
        <p className="text-xs text-ink-400 text-center -mt-1">
          By creating an account you agree to the{" "}
          <Link to="/terms" className="text-violet-600 hover:underline">
            Terms
          </Link>{" "}
          and{" "}
          <Link to="/privacy" className="text-violet-600 hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    </AuthLayout>
  );
}
