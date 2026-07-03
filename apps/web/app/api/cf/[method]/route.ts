import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side proxy for the Codeforces API.
 *
 * The browser never talks to codeforces.com (no CORS there) — it calls
 * /api/cf/{method}?{qs} and we forward to
 * https://codeforces.com/api/{method}?{qs}.
 *
 * problemset.problems / contest.list are cached for 24h via Next's data
 * cache (they return the whole archive; refetching per request would be
 * wasteful and would hammer CF). user.* calls are never cached.
 */

const ALLOWED_METHODS = new Set([
  "problemset.problems",
  "user.info",
  "user.status",
  "contest.list",
]);

const CACHED_METHODS = new Set(["problemset.problems", "contest.list"]);

// Naive per-instance throttle: serialize upstream calls with a minimum gap so
// a burst of users can't push this instance past CF's ~5 req/s limit.
const MIN_GAP_MS = 250;
let lastCallAt = 0;
let queue: Promise<void> = Promise.resolve();

function throttle(): Promise<void> {
  queue = queue.then(async () => {
    const wait = lastCallAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
  });
  return queue;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ method: string }> },
) {
  const { method } = await params;
  if (!ALLOWED_METHODS.has(method)) {
    return NextResponse.json(
      { status: "FAILED", comment: `method not allowed: ${method}` },
      { status: 400 },
    );
  }

  const qs = req.nextUrl.searchParams.toString();
  const url = `https://codeforces.com/api/${method}${qs ? `?${qs}` : ""}`;

  await throttle();

  let upstream: Response;
  try {
    upstream = await fetch(
      url,
      CACHED_METHODS.has(method)
        ? { next: { revalidate: 86400 } }
        : { cache: "no-store" },
    );
  } catch {
    return NextResponse.json(
      { status: "FAILED", comment: "could not reach codeforces.com" },
      { status: 502 },
    );
  }

  let body: unknown;
  try {
    body = await upstream.json();
  } catch {
    return NextResponse.json(
      { status: "FAILED", comment: `codeforces returned non-JSON (HTTP ${upstream.status})` },
      { status: 502 },
    );
  }

  // CF uses 400 + {status:"FAILED", comment} for bad handles etc. — pass it
  // through so the client sees the real comment.
  return NextResponse.json(body, { status: upstream.ok ? 200 : upstream.status });
}
