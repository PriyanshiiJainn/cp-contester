"use client";

import { useEffect, useState } from "react";

type Language = "cpp" | "python" | "java" | "javascript";

interface SampleTest {
  input: string;
  output: string;
}

interface CaseResult {
  index: number;
  status: "pass" | "fail" | "error";
  passed: boolean;
  expected: string;
  got: string;
  stderr: string | null;
}

interface RunSummary {
  passed: number;
  total: number;
  allPassed: boolean;
  results: CaseResult[];
}

const LANGS: { id: Language; label: string }[] = [
  { id: "cpp", label: "C++" },
  { id: "python", label: "Python 3" },
  { id: "java", label: "Java" },
  { id: "javascript", label: "JavaScript" },
];

const DEFAULT_CODE: Record<Language, string> = {
  cpp: `#include <bits/stdc++.h>
using namespace std;
int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);
  // your code
  return 0;
}
`,
  python: `# your code
`,
  java: `import java.io.*;
import java.util.*;
public class Main {
  public static void main(String[] args) throws Exception {
    // your code
  }
}
`,
  javascript: `// your code (Node)
`,
};

export function SampleRunner({
  problemId,
  problemLabel,
  onSamplesVerdict,
}: {
  problemId: string;
  problemLabel: string;
  /** Called when all samples pass (true) or after a failed run (false). */
  onSamplesVerdict?: (allPassed: boolean) => void;
}) {
  const [samples, setSamples] = useState<SampleTest[] | null>(null);
  const [samplesError, setSamplesError] = useState<string | null>(null);
  const [language, setLanguage] = useState<Language>("cpp");
  const [source, setSource] = useState(DEFAULT_CODE.cpp);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSamples(null);
    setSamplesError(null);
    setSummary(null);
    setRunError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/problems/samples?id=${encodeURIComponent(problemId)}`,
        );
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        setSamples(body.samples as SampleTest[]);
      } catch (e) {
        if (!cancelled) {
          setSamplesError(
            e instanceof Error ? e.message : "failed to load samples",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [problemId]);

  const onLanguageChange = (lang: Language) => {
    setLanguage(lang);
    setSource(DEFAULT_CODE[lang]);
    setSummary(null);
  };

  const runTests = async () => {
    if (!source.trim()) return;
    setRunning(true);
    setRunError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ problemId, language, source }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      const next = body as RunSummary;
      setSummary(next);
      onSamplesVerdict?.(next.allPassed);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "run failed");
      onSamplesVerdict?.(false);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-[#ccc] bg-[#fafafa] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold">
          Sample tests — {problemLabel}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="cf-select"
            value={language}
            onChange={(e) => onLanguageChange(e.target.value as Language)}
          >
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <button
            className="cf-btn font-bold"
            type="button"
            onClick={() => void runTests()}
            disabled={running || !samples?.length}
          >
            {running ? "Running…" : "Run samples"}
          </button>
        </div>
      </div>

      {samplesError && <div className="cf-error">{samplesError}</div>}
      {runError && <div className="cf-error">{runError}</div>}

      {samples && samples.length > 0 && (
        <div className="cf-muted text-xs">
          {samples.length} sample{samples.length === 1 ? "" : "s"} loaded.
          Paste your code, run samples here, then submit on Codeforces for{" "}
          <b>Accepted</b>.
        </div>
      )}

      <textarea
        className="cf-input w-full font-mono text-xs"
        rows={12}
        spellCheck={false}
        value={source}
        onChange={(e) => setSource(e.target.value)}
        placeholder="Paste your solution here"
      />

      {summary && (
        <div className="space-y-2">
          <div
            className={
              summary.allPassed ? "cf-verdict-ok" : "text-[#a00] font-bold"
            }
          >
            {summary.allPassed
              ? `All samples passed (${summary.passed}/${summary.total})`
              : `Samples ${summary.passed}/${summary.total} passed`}
          </div>
          <table className="cf-table">
            <thead>
              <tr>
                <th className="w-16">#</th>
                <th className="w-24">Verdict</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {summary.results.map((r) => (
                <tr key={r.index}>
                  <td>Test {r.index}</td>
                  <td>
                    {r.status === "pass" ? (
                      <span className="cf-verdict-ok">PASS</span>
                    ) : r.status === "fail" ? (
                      <span className="text-[#a00] font-bold">FAIL</span>
                    ) : (
                      <span className="text-[#a00] font-bold">ERROR</span>
                    )}
                  </td>
                  <td className="font-mono text-xs whitespace-pre-wrap">
                    {r.status === "pass" ? (
                      "—"
                    ) : r.stderr ? (
                      r.stderr
                    ) : (
                      <>
                        <div>expected:</div>
                        <pre className="m-0 whitespace-pre-wrap">{r.expected}</pre>
                        <div>got:</div>
                        <pre className="m-0 whitespace-pre-wrap">{r.got}</pre>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
