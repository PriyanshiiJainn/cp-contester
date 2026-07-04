"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, handle }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? "signup failed");
      }
      router.push("/profile");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "signup failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cf-box max-w-md">
      <div className="cf-bar">Sign up</div>
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
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="cf-muted text-xs">At least 8 characters.</span>
        </label>
        <label className="block space-y-1">
          <span className="font-bold">Codeforces handle</span>
          <input
            className="cf-input w-full"
            placeholder="e.g. tourist"
            required
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
          />
          <span className="cf-muted text-xs">
            Must be a real CF handle — contests and stats use this identity.
          </span>
        </label>
        {error && <div className="cf-error">{error}</div>}
        <button className="cf-btn font-bold" type="submit" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>
        <p className="cf-muted text-xs">
          Already have an account? <Link href="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}
