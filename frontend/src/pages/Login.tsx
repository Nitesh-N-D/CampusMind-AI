import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout } from "@/layouts/AuthLayout";
import { Button, ErrorBanner, Input, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/lib/authStore";

export default function Login() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const session = await api.auth.login({ email, password });
      setSession(session);
      navigate(session.role === "admin" ? "/admin" : "/chat");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't sign in. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Use your official college email address"
      footer={
        <>
          New to CampusMind AI?{" "}
          <Link to="/register" className="text-violet-600 font-medium hover:underline">
            Create a student account
          </Link>{" "}
          or{" "}
          <Link to="/register-college" className="text-violet-600 font-medium hover:underline">
            set up your college
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <Input
          id="email"
          type="email"
          label="College email"
          placeholder="name@yourcollege.edu"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          id="password"
          type="password"
          label="Password"
          placeholder="Enter your password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" disabled={loading} className="mt-2">
          {loading && <Spinner />}
          {loading ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}
