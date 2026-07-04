import { NextRequest, NextResponse } from "next/server";
import { throttleCf } from "@/lib/cf-throttle";
import { clientIp, rateLimit } from "@/lib/rate-limit";

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ method: string }> },
) {
  const ip = clientIp(req);
  if (!rateLimit(`cf-proxy:${ip}`, { limit: 60, windowMs: 60_000 })) {
    return NextResponse.json(
      { status: "FAILED", comment: "rate limit exceeded — try again shortly" },
      { status: 429 },
    );
  }

  const { method } = await params;
  if (!ALLOWED_METHODS.has(method)) {
    return NextResponse.json(
      { status: "FAILED", comment: `method not allowed: ${method}` },
      { status: 400 },
    );
  }

  const qs = req.nextUrl.searchParams.toString();
  const url = `https://codeforces.com/api/${method}${qs ? `?${qs}` : ""}`;

  await throttleCf();

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
