/** Sample I/O scraped from a Codeforces problem statement. */

export type SampleTest = { input: string; output: string };

/** Decode common HTML entities in CF <pre> blocks. */
function decodeEntities(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Pull input/output pairs from CF problem HTML.
 * Matches the classic `.sample-test .input/.output pre` layout.
 */
export function parseSamplesFromHtml(html: string): SampleTest[] {
  const samples: SampleTest[] = [];
  const blockRe =
    /<div class="input">[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>[\s\S]*?<\/div>\s*<div class="output">[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    samples.push({
      input: decodeEntities(m[1]).replace(/\r\n/g, "\n"),
      output: decodeEntities(m[2]).replace(/\r\n/g, "\n"),
    });
  }
  return samples;
}

/** Normalize program output for sample comparison (trailing spaces / final newline). */
export function normalizeOutput(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n+$/g, "");
}

export function outputsMatch(got: string, expected: string): boolean {
  return normalizeOutput(got) === normalizeOutput(expected);
}

export async function fetchCfProblemHtml(
  contestId: number,
  index: string,
): Promise<string> {
  const url = `https://codeforces.com/problemset/problem/${contestId}/${index}`;
  const res = await fetch(url, {
    headers: {
      "user-agent": "cp-contester/1.0 (personal virtual contests)",
      accept: "text/html",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`could not fetch problem page (HTTP ${res.status})`);
  }
  return res.text();
}
