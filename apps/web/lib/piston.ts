/**
 * Run source code against stdin via the public Piston API
 * (https://github.com/engineer-man/piston) — same idea as local "parse tests"
 * extensions, but in the browser/server without a local compiler.
 */

export type RunLanguage = "cpp" | "python" | "java" | "javascript";

const PISTON_URL =
  process.env.PISTON_URL ?? "https://emkc.org/api/v2/piston/execute";

const LANG_MAP: Record<
  RunLanguage,
  { language: string; version: string; filename: string }
> = {
  cpp: { language: "c++", version: "*", filename: "main.cpp" },
  python: { language: "python", version: "*", filename: "main.py" },
  java: { language: "java", version: "*", filename: "Main.java" },
  javascript: { language: "javascript", version: "*", filename: "main.js" },
};

export interface PistonRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** Compile / runtime signal from Piston, if any. */
  signal: string | null;
  /** Human-readable failure (compile error, timeout, network). */
  error: string | null;
}

export async function runWithPiston(
  language: RunLanguage,
  source: string,
  stdin: string,
): Promise<PistonRunResult> {
  const meta = LANG_MAP[language];
  let res: Response;
  try {
    res = await fetch(PISTON_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        language: meta.language,
        version: meta.version,
        files: [{ name: meta.filename, content: source }],
        stdin,
        run_timeout: 5000,
        compile_timeout: 10000,
      }),
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      signal: null,
      error: "could not reach the code runner",
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      signal: null,
      error: `code runner HTTP ${res.status}`,
    };
  }

  const body = (await res.json()) as {
    compile?: { stdout?: string; stderr?: string; code?: number };
    run?: {
      stdout?: string;
      stderr?: string;
      code?: number | null;
      signal?: string | null;
    };
  };

  const compileErr = body.compile?.stderr || body.compile?.stdout;
  if (body.compile && (body.compile.code ?? 0) !== 0) {
    return {
      ok: false,
      stdout: "",
      stderr: compileErr ?? "",
      signal: null,
      error: "compilation failed",
    };
  }

  const run = body.run;
  if (!run) {
    return {
      ok: false,
      stdout: "",
      stderr: compileErr ?? "",
      signal: null,
      error: "no run result",
    };
  }

  const signal = run.signal ?? null;
  const stderr = run.stderr ?? "";
  if (signal || (run.code != null && run.code !== 0 && !(run.stdout ?? ""))) {
    return {
      ok: false,
      stdout: run.stdout ?? "",
      stderr,
      signal,
      error: signal ? `runtime signal: ${signal}` : "runtime error",
    };
  }

  return {
    ok: true,
    stdout: run.stdout ?? "",
    stderr,
    signal,
    error: null,
  };
}
