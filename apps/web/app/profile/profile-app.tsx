"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

interface ProfileProblem {
  id: string;
  contestId: number;
  index: string;
  name: string;
  rating: number | null;
  solved: boolean;
  minute: number | null;
}

interface ProfileRound {
  id: string;
  division: string;
  durationMin: number;
  startedAt: string;
  endedAt: string;
  solvedCount: number;
  problemCount: number;
  penalty: number | null;
  problems: ProfileProblem[];
}

interface ProfileData {
  handle: string;
  contestsGiven: number;
  problemsSolved: number;
  avgSolvedPerContest: number;
  solveRate: number;
  cfRating: number | null;
  cfSolvedTotal: number | null;
  rounds: ProfileRound[];
}

const cfProblemUrl = (p: ProfileProblem) =>
  `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ProfileApp({
  sessionHandle,
  sessionEmail,
}: {
  sessionHandle: string | null;
  sessionEmail: string | null;
}) {
  const searchParams = useSearchParams();
  const queryHandle = searchParams.get("handle")?.trim() ?? "";
  const initialHandle = queryHandle || sessionHandle || "";

  const [handleInput, setHandleInput] = useState(initialHandle);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ProfileData | null>(null);

  const loadProfile = useCallback(
    async (handleOverride?: string) => {
      const handle = (handleOverride ?? handleInput).trim();
      if (!handle) return;
      setLoading(true);
      setError(null);
      setData(null);
      try {
        const res = await fetch(
          `/api/round/history?handle=${encodeURIComponent(handle)}`,
        );
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        setData(body as ProfileData);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load profile");
      } finally {
        setLoading(false);
      }
    },
    [handleInput],
  );

  useEffect(() => {
    if (!initialHandle) return;
    setHandleInput(initialHandle);
    void loadProfile(initialHandle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHandle]);

  const isOwnProfile =
    Boolean(sessionHandle) &&
    data?.handle.toLowerCase() === sessionHandle?.toLowerCase();

  return (
    <div className="space-y-4">
      <div className="cf-box">
        <div className="cf-bar">Profile</div>
        <div className="space-y-3 p-4">
          {sessionHandle ? (
            <p className="cf-muted text-xs">
              Signed in as <b>{sessionHandle}</b>
              {sessionEmail ? ` (${sessionEmail})` : ""}. Finished virtual
              contests for your handle are listed below.
            </p>
          ) : (
            <p className="cf-muted text-xs">
              Look up any Codeforces handle, or{" "}
              <Link href="/signup">sign up</Link> /{" "}
              <Link href="/login">log in</Link> to keep contest history on your
              account.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="profile-handle" className="font-bold">
              Codeforces handle:
            </label>
            <input
              id="profile-handle"
              className="cf-input w-56"
              placeholder="e.g. tourist"
              value={handleInput}
              onChange={(e) => setHandleInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void loadProfile()}
              disabled={loading}
            />
            <button
              className="cf-btn"
              type="button"
              onClick={() => void loadProfile()}
              disabled={loading || !handleInput.trim()}
            >
              {loading ? "Loading…" : "Load"}
            </button>
          </div>
          {error && <div className="cf-error">{error}</div>}
        </div>
      </div>

      {data && (
        <>
          <div className="cf-box">
            <div className="cf-bar">
              {data.handle}
              {isOwnProfile ? " (you)" : ""}
            </div>
            <table className="cf-table max-w-lg">
              <tbody>
                <tr>
                  <th>Contests given</th>
                  <td className="font-bold">{data.contestsGiven}</td>
                </tr>
                <tr>
                  <th>Problems solved in contests</th>
                  <td className="font-bold">{data.problemsSolved}</td>
                </tr>
                <tr>
                  <th>Avg solved / contest</th>
                  <td className="font-bold">{data.avgSolvedPerContest}</td>
                </tr>
                <tr>
                  <th>Solve rate</th>
                  <td className="font-bold">{data.solveRate}%</td>
                </tr>
                {data.cfSolvedTotal !== null && (
                  <tr>
                    <th>Problems solved on CF</th>
                    <td>{data.cfSolvedTotal}</td>
                  </tr>
                )}
                {data.cfRating !== null && (
                  <tr>
                    <th>CF rating (public)</th>
                    <td>{data.cfRating}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {data.rounds.length === 0 ? (
            <div className="cf-note">
              No finished contests yet.{" "}
              <Link href="/">Start a virtual contest</Link>, finish it, then
              come back here.
            </div>
          ) : (
            data.rounds.map((round) => {
              const barClass =
                round.division === "1" ? "cf-bar cf-bar--pink" : "cf-bar";
              return (
                <div key={round.id} className="cf-box">
                  <div className={barClass}>
                    Div. {round.division} · {round.durationMin} min ·{" "}
                    {fmtDate(round.endedAt)} ·{" "}
                    <b>
                      {round.solvedCount}/{round.problemCount}
                    </b>{" "}
                    solved
                    {round.penalty != null && (
                      <> · penalty {round.penalty}′</>
                    )}
                  </div>
                  <table className="cf-table">
                    <thead>
                      <tr>
                        <th>Problem</th>
                        <th className="w-20">Rating</th>
                        <th className="w-28">Result</th>
                        <th className="w-36">Codeforces</th>
                      </tr>
                    </thead>
                    <tbody>
                      {round.problems.map((p) => (
                        <tr
                          key={p.id}
                          className={p.solved ? "cf-row--solved" : undefined}
                        >
                          <td>
                            {p.name}{" "}
                            <span className="cf-muted text-xs">
                              ({p.contestId}
                              {p.index})
                            </span>
                          </td>
                          <td>{p.rating ?? "—"}</td>
                          <td>
                            {p.solved ? (
                              <span className="cf-verdict-ok">
                                Accepted
                                {p.minute != null ? ` at ${p.minute}′` : ""}
                              </span>
                            ) : (
                              <span className="cf-muted">unsolved</span>
                            )}
                          </td>
                          <td>
                            {p.contestId > 0 ? (
                              <a
                                className="cf-btn inline-block !px-2 !py-0.5 text-xs no-underline hover:no-underline"
                                href={cfProblemUrl(p)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Open on Codeforces to submit"
                              >
                                Open on CF
                              </a>
                            ) : (
                              <span className="cf-muted">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
