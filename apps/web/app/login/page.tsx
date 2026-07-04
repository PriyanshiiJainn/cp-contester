"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? "login failed");
      }
      router.push("/profile");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cf-box max-w-md">
      <div className="cf-bar">Log in</div>
      <form className="space-y-3 p-4" onSubmit={onSubmit}>
        <label className="block space-y-1">
          <span className="font-bold">Email</span>
          <input
            className="cf-input w-full"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="font-bold">Password</span>
          <input
            className="cf-input w-full"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <div className="cf-error">{error}</div>}
        <button className="cf-btn font-bold" type="submit" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
        <p className="cf-muted text-xs">
          No account? <Link href="/signup">Sign up</Link>
        </p>
      </form>
    </div>
  );
}
