"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCfClient, solvedKeys, CfApiError } from "@cp/cf";
import { estimate } from "@cp/rating";

/* ------------------------------------------------------------------ types */

interface Slot {
  label: string;
  id: string;
  contestId: number;
  index: string;
  name: string;
  rating: number;
}

interface SolveMark {
  minute: number;
  manual: boolean;
}

interface Round {
  handle: string;
  division: "1" | "2" | "3" | "4";
  durationMin: number;
  startedAt: number; // epoch ms — remaining time is ALWAYS derived from this
  ratingBefore: number | null;
  slots: Slot[];
  solved: Record<string, SolveMark>;
}

interface RoundResult {
  perf: number;
  delta: number;
  solvedCount: number;
  endedAt: number;
}

type Phase = "setup" | "running" | "finished";

/* ------------------------------------------------------------------ const */

const cf = createCfClient(); // browser -> /api/cf proxy, never codeforces.com

const DIVISIONS = ["1", "2", "3", "4"] as const;
const DURATIONS = [60, 90, 120, 150, 180];
const POLL_MS = 20_000;
const STORAGE_KEY = "cp-contester:active-round";
const UNRATED_BASELINE = 1400;

const problemUrl = (s: Slot) =>
  `https://codeforces.com/problemset/problem/${s.contestId}/${s.index}`;

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function loadStoredRound(): Round | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const round = JSON.parse(raw) as Round;
    if (!round.startedAt || !Array.isArray(round.slots) || round.slots.length === 0) {
      return null;
    }
    return round;
  } catch {
    return null;
  }
}

function storeRound(round: Round | null) {
  try {
    if (round) localStorage.setItem(STORAGE_KEY, JSON.stringify(round));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — the round just won't survive a refresh */
  }
}

/* -------------------------------------------------------------- component */

export function ContestApp() {
  const [phase, setPhase] = useState<Phase>("setup");

  // setup state
  const [handleInput, setHandleInput] = useState("");
  const [userLoading, setUserLoading] = useState(false);
  const [user, setUser] = useState<{ handle: string; rating: number | null } | null>(null);
  const [solvedTotal, setSolvedTotal] = useState<number | null>(null);
  const [division, setDivision] = useState<Round["division"]>("2");
  const [durationMin, setDurationMin] = useState(120);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // running / finished state
  const [round, setRound] = useState<Round | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [lastPollAt, setLastPollAt] = useState<number | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  const roundRef = useRef<Round | null>(null);
  roundRef.current = round;
  const finishedRef = useRef(false);

  const endAt = round ? round.startedAt + round.durationMin * 60_000 : 0;

  /* ---- finish ---- */

  const finishContest = useCallback(
    (endedAtMs: number) => {
      const r = roundRef.current;
      if (!r || finishedRef.current) return;
      finishedRef.current = true;

      const cappedEnd = Math.min(endedAtMs, r.startedAt + r.durationMin * 60_000);
      const solvedIds = Object.keys(r.solved);
      const est = estimate({
        slotRatings: r.slots.map((s) => s.rating),
        solvedCount: solvedIds.length,
        rating: r.ratingBefore ?? UNRATED_BASELINE,
      });
      setResult({ ...est, solvedCount: solvedIds.length, endedAt: cappedEnd });
      setPhase("finished");
      storeRound(null);

      setSaveState("saving");
      fetch("/api/round/finish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: r.handle,
          division: r.division,
          durationMin: r.durationMin,
          startedAt: r.startedAt,
          endedAt: cappedEnd,
          problemIds: r.slots.map((s) => s.id),
          solvedIds,
          perf: est.perf,
          delta: est.delta,
          ratingBefore: r.ratingBefore,
        }),
      })
        .then((res) => setSaveState(res.ok ? "saved" : "failed"))
        .catch(() => setSaveState("failed"));
    },
    [],
  );

  /* ---- restore an in-flight round on mount (refresh can't reset the clock) */

  useEffect(() => {
    const stored = loadStoredRound();
    if (!stored) return;
    // Set the ref immediately — setState alone won't update it until the next
    // render, and finishContest (below) reads roundRef, not state.
    roundRef.current = stored;
    setRound(stored);
    const storedEnd = stored.startedAt + stored.durationMin * 60_000;
    if (Date.now() >= storedEnd) {
      // Timer ran out while the tab was closed: settle the round now.
      setPhase("running");
      queueMicrotask(() => finishContest(storedEnd));
    } else {
      setPhase("running");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- 4Hz wall-clock tick; ends the round when derived time hits zero */

  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (roundRef.current && Date.now() >= roundRef.current.startedAt + roundRef.current.durationMin * 60_000) {
        finishContest(Date.now());
      }
    }, 250);
    return () => clearInterval(t);
  }, [phase, finishContest]);

  /* ---- poll user.status every 20s while running ---- */

  useEffect(() => {
    if (phase !== "running" || !round) return;

    let cancelled = false;
    const poll = async () => {
      const r = roundRef.current;
      if (!r) return;
      try {
        // Recent submissions are enough mid-contest; keeps payloads small.
        const subs = await cf.getUserStatus(r.handle, { from: 1, count: 100 });
        if (cancelled) return;
        const slotIds = new Set(r.slots.map((s) => s.id));
        const roundEnd = r.startedAt + r.durationMin * 60_000;
        let changed = false;
        const solved = { ...r.solved };
        for (const sub of subs) {
          const cid = sub.problem.contestId ?? sub.contestId;
          if (sub.verdict !== "OK" || cid === undefined) continue;
          const key = `${cid}${sub.problem.index}`;
          const t = sub.creationTimeSeconds * 1000;
          if (!slotIds.has(key) || solved[key] || t < r.startedAt || t > roundEnd) continue;
          solved[key] = {
            minute: Math.floor((t - r.startedAt) / 60_000),
            manual: false,
          };
          changed = true;
        }
        if (changed) {
          const next = { ...r, solved };
          setRound(next);
          storeRound(next);
        }
        setPollError(null);
        setLastPollAt(Date.now());
      } catch (e) {
        if (!cancelled) {
          setPollError(
            e instanceof CfApiError
              ? `Codeforces poll failed: ${e.message}`
              : "Codeforces poll failed — use the manual toggle if this persists.",
          );
        }
      }
    };

    poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, round?.startedAt]);

  /* ---- setup actions ---- */

  const loadUser = async () => {
    const handle = handleInput.trim();
    if (!handle) return;
    setUserLoading(true);
    setError(null);
    setUser(null);
    setSolvedTotal(null);
    try {
      const [info, subs] = await Promise.all([
        cf.getUserInfo(handle),
        cf.getUserStatus(handle),
      ]);
      setUser({ handle: info.handle, rating: info.rating ?? null });
      setSolvedTotal(solvedKeys(subs).size);
    } catch (e) {
      setError(
        e instanceof CfApiError
          ? `Codeforces says: ${e.message}`
          : "Failed to load the handle. Try again.",
      );
    } finally {
      setUserLoading(false);
    }
  };

  const startContest = async () => {
    if (!user) return;
    setBuilding(true);
    setError(null);
    try {
      const res = await fetch("/api/contest/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: user.handle, division }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `contest build failed (HTTP ${res.status})`);
      }
      const newRound: Round = {
        handle: user.handle,
        division,
        durationMin,
        startedAt: Date.now(),
        ratingBefore: user.rating,
        slots: data.slots as Slot[],
        solved: {},
      };
      finishedRef.current = false;
      setResult(null);
      setSaveState("idle");
      setRound(newRound);
      storeRound(newRound);
      setPhase("running");
    } catch (e) {
      setError(e instanceof Error ? e.message : "contest build failed");
    } finally {
      setBuilding(false);
    }
  };

  const toggleManual = (slotId: string) => {
    const r = roundRef.current;
    if (!r || phase !== "running") return;
    const solved = { ...r.solved };
    const mark = solved[slotId];
    if (mark) {
      if (!mark.manual) return; // auto-detected ACs can't be unmarked
      delete solved[slotId];
    } else {
      const minute = Math.min(
        Math.floor((Date.now() - r.startedAt) / 60_000),
        r.durationMin,
      );
      solved[slotId] = { minute, manual: true };
    }
    const next = { ...r, solved };
    setRound(next);
    storeRound(next);
  };

  const resetToSetup = () => {
    finishedRef.current = false;
    setRound(null);
    setResult(null);
    setSaveState("idle");
    setPollError(null);
    setLastPollAt(null);
    storeRound(null);
    setPhase("setup");
  };

  /* ---- derived ---- */

  const remaining = endAt - now;
  const solvedCount = round ? Object.keys(round.solved).length : 0;
  const barClass = round?.division === "1" ? "cf-bar cf-bar--pink" : "cf-bar";
  const ratingAfter =
    result && round ? (round.ratingBefore ?? UNRATED_BASELINE) + result.delta : null;

  /* ================================================================ render */

  if (phase === "setup") {
    return (
      <div className="space-y-4">
        <div className="cf-box">
          <div className="cf-bar">Start a virtual contest</div>
          <div className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="handle" className="font-bold">
                Codeforces handle:
              </label>
              <input
                id="handle"
                className="cf-input w-56"
                placeholder="e.g. tourist"
                value={handleInput}
                onChange={(e) => setHandleInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadUser()}
                disabled={userLoading}
              />
              <button className="cf-btn" onClick={loadUser} disabled={userLoading || !handleInput.trim()}>
                {userLoading ? "Loading…" : "Load"}
              </button>
              <span className="cf-muted text-xs">
                no password — public data only
              </span>
            </div>

            {user && (
              <div className="cf-note">
                <b>{user.handle}</b> — rating{" "}
                <b>{user.rating ?? `unrated (using ${UNRATED_BASELINE} for the estimate)`}</b>
                {solvedTotal !== null && (
                  <>
                    , <b>{solvedTotal}</b> problems solved (these are excluded from
                    your contest)
                  </>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2">
                <span className="font-bold">Division:</span>
                <select
                  className="cf-select"
                  value={division}
                  onChange={(e) => setDivision(e.target.value as Round["division"])}
                >
                  {DIVISIONS.map((d) => (
                    <option key={d} value={d}>
                      Div. {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="font-bold">Duration:</span>
                <select
                  className="cf-select"
                  value={durationMin}
                  onChange={(e) => setDurationMin(Number(e.target.value))}
                >
                  {DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {d} minutes
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="cf-btn font-bold"
                onClick={startContest}
                disabled={!user || building}
                title={user ? "" : "Load a handle first"}
              >
                {building ? "Building contest…" : "Start"}
              </button>
            </div>

            {error && <div className="cf-error">{error}</div>}

            <p className="cf-muted text-xs">
              The timer is non-pausable and survives refreshes. Problems open on
              codeforces.com — submit there; ACs are detected automatically.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "running" && round) {
    return (
      <div className="space-y-3">
        <div className="cf-box">
          <div className={`${barClass} flex flex-wrap items-center justify-between gap-2`}>
            <span>
              Virtual contest — Div. {round.division} — {round.handle}
            </span>
            <span className="flex items-center gap-3">
              <span className="cf-countdown">{fmtClock(remaining)}</span>
              <button className="cf-btn cf-btn--danger" onClick={() => finishContest(Date.now())}>
                End Contest
              </button>
            </span>
          </div>
          <table className="cf-table">
            <thead>
              <tr>
                <th className="w-10">#</th>
                <th>Problem</th>
                <th className="w-20">Rating</th>
                <th className="w-56">Status</th>
              </tr>
            </thead>
            <tbody>
              {round.slots.map((s) => {
                const mark = round.solved[s.id];
                return (
                  <tr key={s.id} className={mark ? "cf-row--solved" : undefined}>
                    <td className="text-center font-bold">{s.label}</td>
                    <td>
                      <a href={problemUrl(s)} target="_blank" rel="noopener noreferrer">
                        {s.name}
                      </a>{" "}
                      <span className="cf-muted text-xs">({s.contestId}{s.index})</span>
                    </td>
                    <td>{s.rating}</td>
                    <td>
                      {mark ? (
                        <span className="cf-verdict-ok">
                          Solved at {mark.minute}′{mark.manual ? " (manual)" : ""}
                        </span>
                      ) : (
                        <span className="cf-muted">—</span>
                      )}{" "}
                      {(!mark || mark.manual) && (
                        <button
                          className="cf-btn ml-1 !px-2 !py-0.5 text-xs"
                          onClick={() => toggleManual(s.id)}
                          title="Fallback when AC polling is blocked or offline"
                        >
                          {mark?.manual ? "unmark" : "mark solved"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="cf-muted">
            Solved {solvedCount}/{round.slots.length} · checking Codeforces every 20s
            {lastPollAt ? ` · last check ${fmtClock(now - lastPollAt)} ago` : ""}
          </span>
          {pollError && <span className="cf-error !py-1">{pollError}</span>}
        </div>
      </div>
    );
  }

  if (phase === "finished" && round && result) {
    return (
      <div className="space-y-3">
        <div className="cf-box">
          <div className={barClass}>
            Contest finished — Div. {round.division} — {round.handle}
          </div>
          <div className="space-y-3 p-4">
            <table className="cf-table max-w-md">
              <tbody>
                <tr>
                  <th>Solved</th>
                  <td>
                    {result.solvedCount} / {round.slots.length}
                  </td>
                </tr>
                <tr>
                  <th>Estimated performance</th>
                  <td className="font-bold">{result.perf}</td>
                </tr>
                <tr>
                  <th>Estimated rating change</th>
                  <td>
                    {round.ratingBefore ?? `${UNRATED_BASELINE} (unrated baseline)`} →{" "}
                    <b>{ratingAfter}</b>{" "}
                    <span className={result.delta >= 0 ? "cf-verdict-ok" : "text-[#a00] font-bold"}>
                      ({result.delta >= 0 ? "+" : ""}
                      {result.delta})
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="cf-note">
              This is a rough single-user <b>estimate</b> from problem difficulties
              only — not a real Codeforces rating prediction. Speed, hacks, and the
              field of participants are ignored.
            </div>

            <div className="cf-muted text-xs">
              {saveState === "saving" && "Saving round…"}
              {saveState === "saved" && "Round saved."}
              {saveState === "failed" && "Could not save this round to the database."}
            </div>

            <button className="cf-btn font-bold" onClick={resetToSetup}>
              New round
            </button>
          </div>
        </div>

        <div className="cf-box">
          <div className="cf-bar">Problems</div>
          <table className="cf-table">
            <thead>
              <tr>
                <th className="w-10">#</th>
                <th>Problem</th>
                <th className="w-20">Rating</th>
                <th className="w-44">Result</th>
              </tr>
            </thead>
            <tbody>
              {round.slots.map((s) => {
                const mark = round.solved[s.id];
                return (
                  <tr key={s.id} className={mark ? "cf-row--solved" : undefined}>
                    <td className="text-center font-bold">{s.label}</td>
                    <td>
                      <a href={problemUrl(s)} target="_blank" rel="noopener noreferrer">
                        {s.name}
                      </a>{" "}
                      <span className="cf-muted text-xs">({s.contestId}{s.index})</span>
                    </td>
                    <td>{s.rating}</td>
                    <td>
                      {mark ? (
                        <span className="cf-verdict-ok">
                          Solved at {mark.minute}′{mark.manual ? " (manual)" : ""}
                        </span>
                      ) : (
                        <span className="cf-muted">unsolved</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return null; // transient state while restoring
}
