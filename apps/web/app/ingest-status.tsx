"use client";

import { useEffect, useState } from "react";

interface HealthPayload {
  ok: boolean;
  problems: number;
  lastIngestAt: string | null;
  lastIngestError: string | null;
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "never";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function IngestStatus() {
  const [health, setHealth] = useState<HealthPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then(async (res) => {
        const data = (await res.json()) as HealthPayload;
        if (!cancelled) setHealth(data);
      })
      .catch(() => {
        if (!cancelled) {
          setHealth({
            ok: false,
            problems: 0,
            lastIngestAt: null,
            lastIngestError: "health check failed",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!health) {
    return (
      <p className="cf-muted text-xs" aria-live="polite">
        Checking problem cache…
      </p>
    );
  }

  if (!health.ok) {
    return (
      <p className="cf-error !py-1 text-xs" role="status">
        Problem cache not ready ({health.problems} problems
        {health.lastIngestAt ? `, last ingest ${fmtWhen(health.lastIngestAt)}` : ", never ingested"}
        ). An operator must run{" "}
        <code className="text-[0.7rem]">/api/ingest</code> with{" "}
        <code className="text-[0.7rem]">CRON_SECRET</code>
        {health.lastIngestError ? ` — last error: ${health.lastIngestError}` : ""}.
      </p>
    );
  }

  return (
    <p className="cf-muted text-xs" role="status">
      Problem cache: <b>{health.problems.toLocaleString()}</b> problems · last ingested{" "}
      <b>{fmtWhen(health.lastIngestAt)}</b>
    </p>
  );
}
