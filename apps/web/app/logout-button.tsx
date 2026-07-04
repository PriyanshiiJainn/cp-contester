"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="cf-btn !py-0.5 text-xs" onClick={logout} disabled={busy}>
      {busy ? "…" : "Log out"}
    </button>
  );
}
