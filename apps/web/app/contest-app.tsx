"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createCfClient, roundProgress, solvedKeys, CfApiError } from "@cp/cf";
import { IngestStatus } from "./ingest-status";
import { SampleRunner } from "./sample-runner";

/* ------------------------------------------------------------------ types */

interface Slot {
  label: string;
  id: string;
  contestId: number;
  index: string;
  name: string;
  rating: number;
}

interface ProblemMark {
  minute: number | null;
  wrongAttempts: number;
  partial: number;
  manual: boolean;
}

interface Round {
  handle: string;
  division: "1" | "2" | "3" | "4";
  durationMin: number;
  startedAt: number;
  slots: Slot[];
  marks: Record<string, ProblemMark>;
  /** Set when the round ends so a failed save can be retried after refresh. */
  finishedAt?: number;
}

interface RoundResult {
  solvedCount: number;
  penalty: number;
  endedAt: number;
}

type Phase = "setup" | "running" | "finished";

/* ------------------------------------------------------------------ const */

const cf = createCfClient();
const DIVISIONS = ["1", "2", "3", "4"] as const;
const DURATIONS = [60, 90, 120, 150, 180];
const POLL_MS = 20_000;
const STORAGE_KEY = "cp-contester:active-round";
const ICPC_WRONG_PENALTY = 20;

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

function isFullSolve(m: ProblemMark | undefined): boolean {
  return m != null && m.minute != null && m.partial >= 1;
}

function computePenalty(round: Round): number {
  let penalty = 0;
  for (const s of round.slots) {
    const m = round.marks[s.id];
    if (!isFullSolve(m) || m.minute == null) continue;
    penalty += m.minute + ICPC_WRONG_PENALTY * Math.max(0, m.wrongAttempts);
  }
  return penalty;
}

function normalizeRound(raw: unknown): Round | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Round> & {
    solved?: Record<string, { minute: number; manual: boolean }>;
  };
  if (!r.startedAt || !Array.isArray(r.slots) || r.slots.length === 0) return null;
  if (!r.handle || !r.division || !r.durationMin) return null;

  let marks = r.marks;
  if (!marks && r.solved) {
    marks = {};
    for (const [id, m] of Object.entries(r.solved)) {
      marks[id] = {
        minute: m.minute,
        wrongAttempts: 0,
        partial: 1,
        manual: m.manual,
      };
    }
  }
  marks ??= {};

  return {
    handle: r.handle,
    division: r.division,
    durationMin: r.durationMin,
    startedAt: r.startedAt,
    slots: r.slots,
    marks,
    finishedAt: typeof r.finishedAt === "number" ? r.finishedAt : undefined,
  };
}

function loadStoredRound(): Round | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeRound(JSON.parse(raw));
  } catch {
    return null;
  }
}

function storeRound(round: Round | null) {
  try {
    if (round) localStorage.setItem(STORAGE_KEY, JSON.stringify(round));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

function finishPayload(round: Round, endedAt: number) {
  return {
    handle: round.handle,
    division: round.division,
    durationMin: round.durationMin,
    startedAt: round.startedAt,
    endedAt,
    problemIds: round.slots.map((s) => s.id),
    outcomes: round.slots.map((s) => {
      const m = round.marks[s.id];
      return {
        id: s.id,
        minute: isFullSolve(m) ? m!.minute : null,
        wrongAttempts: m?.wrongAttempts ?? 0,
      };
    }),
  };
}

/* -------------------------------------------------------------- component */

export function ContestApp() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [handleInput, setHandleInput] = useState("");
  const [userLoading, setUserLoading] = useState(false);
  const [user, setUser] = useState<{ handle: string; rating: number | null } | null>(null);
  const [solvedTotal, setSolvedTotal] = useState<number | null>(null);
  const [division, setDivision] = useState<Round["division"]>("2");
  const [durationMin, setDurationMin] = useState(120);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [round, setRound] = useState<Round | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [lastPollAt, setLastPollAt] = useState<number | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [openSlotId, setOpenSlotId] = useState<string | null>(null);
  const [samplesOk, setSamplesOk] = useState<Record<string, boolean>>({});

  const roundRef = useRef<Round | null>(null);
  roundRef.current = round;
  const finishedRef = useRef(false);

  const endAt = round ? round.startedAt + round.durationMin * 60_000 : 0;

  const saveRound = useCallback(async (r: Round, endedAtMs: number) => {
    setSaveState("saving");
    try {
      const res = await fetch("/api/round/finish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(finishPayload(r, endedAtMs)),
      });
      const data = (await res.json().catch(() => ({}))) as {
        solvedCount?: number;
        penalty?: number;
        error?: string;
      };
      if (!res.ok) {
        setSaveState("failed");
        return;
      }
      // Prefer server-recomputed totals (authoritative on retry).
      if (typeof data.solvedCount === "number" && typeof data.penalty === "number") {
        setResult({
          solvedCount: data.solvedCount,
          penalty: data.penalty,
          endedAt: endedAtMs,
        });
      }
      setSaveState("saved");
      storeRound(null);
    } catch {
      setSaveState("failed");
    }
  }, []);

  const finishContest = useCallback(
    (endedAtMs: number) => {
      const r = roundRef.current;
      if (!r || finishedRef.current) return;
      finishedRef.current = true;

      const cappedEnd = Math.min(endedAtMs, r.startedAt + r.durationMin * 60_000);
      const solvedCount = r.slots.filter((s) => isFullSolve(r.marks[s.id])).length;
      const penalty = computePenalty(r);
      const finished: Round = { ...r, finishedAt: cappedEnd };

      setResult({ solvedCount, penalty, endedAt: cappedEnd });
      setPhase("finished");
      setRound(finished);
      roundRef.current = finished;
      storeRound(finished);
      void saveRound(finished, cappedEnd);
    },
    [saveRound],
  );

  useEffect(() => {
    const stored = loadStoredRound();
    if (!stored) return;
    roundRef.current = stored;
    setRound(stored);

    if (stored.finishedAt != null) {
      finishedRef.current = true;
      setResult({
        solvedCount: stored.slots.filter((s) => isFullSolve(stored.marks[s.id])).length,
        penalty: computePenalty(stored),
        endedAt: stored.finishedAt,
      });
      setPhase("finished");
      queueMicrotask(() => void saveRound(stored, stored.finishedAt!));
      return;
    }

    const storedEnd = stored.startedAt + stored.durationMin * 60_000;
    if (Date.now() >= storedEnd) {
      setPhase("running");
      queueMicrotask(() => finishContest(storedEnd));
    } else {
      setPhase("running");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loadStoredRound()) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        const data = await res.json();
        const handle = data?.user?.handle as string | undefined;
        if (cancelled || !handle) return;
        setHandleInput(handle);
        setUserLoading(true);
        setError(null);
        try {
          const [info, subs] = await Promise.all([
            cf.getUserInfo(handle),
            cf.getUserStatus(handle, { from: 1, count: 10_000 }),
          ]);
          if (cancelled) return;
          setUser({ handle: info.handle, rating: info.rating ?? null });
          setSolvedTotal(solvedKeys(subs).size);
        } catch (e) {
          if (!cancelled) {
            setError(
              e instanceof CfApiError
                ? `Codeforces says: ${e.message}`
                : "Failed to load the handle. Try again.",
            );
          }
        } finally {
          if (!cancelled) setUserLoading(false);
        }
      } catch {
        /* not logged in */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (
        roundRef.current &&
        Date.now() >=
          roundRef.current.startedAt + roundRef.current.durationMin * 60_000
      ) {
        finishContest(Date.now());
      }
    }, 250);
    return () => clearInterval(t);
  }, [phase, finishContest]);

  useEffect(() => {
    if (phase !== "running" || !round) return;

    let cancelled = false;
    const poll = async () => {
      const r = roundRef.current;
      if (!r) return;
      try {
        const subs = await cf.getUserStatus(r.handle, { from: 1, count: 100 });
        if (cancelled) return;
        const slotIds = new Set(r.slots.map((s) => s.id));
        const roundEnd = r.startedAt + r.durationMin * 60_000;
        const progress = roundProgress(subs, {
          startedAt: r.startedAt,
          endedAt: Math.min(Date.now(), roundEnd),
          slotIds,
        });

        const marks = { ...r.marks };
        let changed = false;
        for (const [key, p] of progress) {
          const prev = marks[key];
          if (prev?.manual && isFullSolve(prev)) continue;
          const nextMark: ProblemMark = {
            minute: p.minute,
            wrongAttempts: p.wrongAttempts,
            partial: p.partial,
            manual: false,
          };
          if (
            !prev ||
            prev.minute !== nextMark.minute ||
            prev.wrongAttempts !== nextMark.wrongAttempts ||
            prev.partial !== nextMark.partial ||
            prev.manual
          ) {
            marks[key] = nextMark;
            changed = true;
          }
        }
        if (changed) {
          const next = { ...r, marks };
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
        cf.getUserStatus(handle, { from: 1, count: 10_000 }),
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
        slots: data.slots as Slot[],
        marks: {},
      };
      finishedRef.current = false;
      setResult(null);
      setSaveState("idle");
      setSamplesOk({});
      setOpenSlotId(null);
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
    const marks = { ...r.marks };
    const mark = marks[slotId];
    if (mark && isFullSolve(mark)) {
      if (!mark.manual) return;
      delete marks[slotId];
    } else {
      const minute = Math.min(
        Math.floor((Date.now() - r.startedAt) / 60_000),
        r.durationMin,
      );
      marks[slotId] = {
        minute,
        wrongAttempts: mark?.wrongAttempts ?? 0,
        partial: 1,
        manual: true,
      };
    }
    const next = { ...r, marks };
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
    setSamplesOk({});
    setOpenSlotId(null);
    storeRound(null);
    setPhase("setup");
  };

  const remaining = endAt - now;
  const solvedCount = round
    ? round.slots.filter((s) => isFullSolve(round.marks[s.id])).length
    : 0;
  const barClass = round?.division === "1" ? "cf-bar cf-bar--pink" : "cf-bar";

  const formatStatus = (slotId: string, mark: ProblemMark | undefined): ReactNode => {
    if (isFullSolve(mark)) {
      return (
        <span className="cf-verdict-ok">
          Accepted
          {mark!.minute != null ? ` at ${mark!.minute}′` : ""}
          {mark!.manual ? " (manual)" : ""}
        </span>
      );
    }
    if (samplesOk[slotId]) {
      return <span className="cf-verdict-ok">Samples passed</span>;
    }
    if (mark && mark.wrongAttempts > 0) {
      return <span className="cf-muted">{mark.wrongAttempts} wrong on CF</span>;
    }
    return <span className="cf-muted">—</span>;
  };

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
                onKeyDown={(e) => e.key === "Enter" && void loadUser()}
                disabled={userLoading}
              />
              <button
                className="cf-btn"
                type="button"
                onClick={() => void loadUser()}
                disabled={userLoading || !handleInput.trim()}
              >
                {userLoading ? "Loading…" : "Load"}
              </button>
              <span className="cf-muted text-xs">
                public CF data — <a href="/signup">sign up</a> to keep history on
                your profile
              </span>
            </div>

            {user && (
              <div className="cf-note">
                <b>{user.handle}</b>
                {user.rating != null && (
                  <>
                    {" "}
                    — CF rating <b>{user.rating}</b>
                  </>
                )}
                {solvedTotal !== null && (
                  <>
                    , <b>{solvedTotal}</b> problems already solved on CF (excluded
                    from your contest)
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
                type="button"
                onClick={() => void startContest()}
                disabled={!user || building}
                title={user ? "" : "Load a handle first"}
              >
                {building ? "Building contest…" : "Start"}
              </button>
            </div>

            {error && <div className="cf-error">{error}</div>}
            <IngestStatus />
            <p className="cf-muted text-xs">
              Run sample tests in the app (like a parse-tests extension), then
              submit on codeforces.com. Accepted is detected automatically.
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
              <button
                className="cf-btn cf-btn--danger"
                type="button"
                onClick={() => finishContest(Date.now())}
              >
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
                <th className="w-48">Status</th>
                <th className="w-40">Actions</th>
              </tr>
            </thead>
            <tbody>
              {round.slots.map((s) => {
                const mark = round.marks[s.id];
                const open = openSlotId === s.id;
                return (
                  <Fragment key={s.id}>
                    <tr
                      className={isFullSolve(mark) ? "cf-row--solved" : undefined}
                    >
                      <td className="text-center font-bold">{s.label}</td>
                      <td>
                        <a
                          href={problemUrl(s)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {s.name}
                        </a>{" "}
                        <span className="cf-muted text-xs">
                          ({s.contestId}
                          {s.index})
                        </span>
                      </td>
                      <td>{s.rating}</td>
                      <td>{formatStatus(s.id, mark)}</td>
                      <td>
                        <button
                          className="cf-btn !px-2 !py-0.5 text-xs"
                          type="button"
                          onClick={() => setOpenSlotId(open ? null : s.id)}
                        >
                          {open ? "Hide tests" : "Sample tests"}
                        </button>{" "}
                        <a
                          className="cf-btn !px-2 !py-0.5 text-xs no-underline hover:no-underline"
                          href={problemUrl(s)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Submit on CF
                        </a>
                        {(!mark || mark.manual || !isFullSolve(mark)) && (
                          <>
                            {" "}
                            <button
                              className="cf-btn !px-2 !py-0.5 text-xs"
                              type="button"
                              onClick={() => toggleManual(s.id)}
                              title="Fallback when AC polling is blocked"
                            >
                              {isFullSolve(mark) && mark?.manual
                                ? "unmark"
                                : "mark AC"}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={5} className="!p-0">
                          <SampleRunner
                            problemId={s.id}
                            problemLabel={`${s.label}. ${s.name}`}
                            onSamplesVerdict={(ok) =>
                              setSamplesOk((prev) => ({ ...prev, [s.id]: ok }))
                            }
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="cf-muted">
            Accepted {solvedCount}/{round.slots.length} · checking Codeforces
            every 20s
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
                  <td className="font-bold">
                    {result.solvedCount} / {round.slots.length}
                  </td>
                </tr>
                <tr>
                  <th>ICPC penalty</th>
                  <td>{result.penalty} min</td>
                </tr>
              </tbody>
            </table>

            <div className="cf-muted text-xs">
              {saveState === "saving" && "Saving round…"}
              {saveState === "saved" && (
                <>
                  Round saved. See your{" "}
                  <a href={`/profile?handle=${encodeURIComponent(round.handle)}`}>
                    profile
                  </a>{" "}
                  for history and stats.
                </>
              )}
              {saveState === "failed" &&
                "Could not save this round. Retry to write it to your profile — solves and penalty are recomputed on the server."}
            </div>

            <div className="flex flex-wrap gap-2">
              {saveState === "failed" && (
                <button
                  className="cf-btn font-bold"
                  type="button"
                  onClick={() =>
                    void saveRound(round, result.endedAt)
                  }
                >
                  Retry save
                </button>
              )}
              <button
                className="cf-btn font-bold"
                type="button"
                onClick={resetToSetup}
              >
                New round
              </button>
              <a
                className="cf-btn font-bold no-underline hover:no-underline"
                href={`/profile?handle=${encodeURIComponent(round.handle)}`}
              >
                Open profile
              </a>
            </div>
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
                <th className="w-28">Codeforces</th>
              </tr>
            </thead>
            <tbody>
              {round.slots.map((s) => {
                const mark = round.marks[s.id];
                return (
                  <tr
                    key={s.id}
                    className={isFullSolve(mark) ? "cf-row--solved" : undefined}
                  >
                    <td className="text-center font-bold">{s.label}</td>
                    <td>
                      {s.name}{" "}
                      <span className="cf-muted text-xs">
                        ({s.contestId}
                        {s.index})
                      </span>
                    </td>
                    <td>{s.rating}</td>
                    <td>{formatStatus(s.id, mark)}</td>
                    <td>
                      <a
                        className="cf-btn inline-block !px-2 !py-0.5 text-xs no-underline hover:no-underline"
                        href={problemUrl(s)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open on CF
                      </a>
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

  return null;
}
