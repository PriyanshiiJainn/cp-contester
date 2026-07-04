/**
 * Sliding-window rate limiter (per-process memory only).
 * Returns true when the request is allowed, false when limited.
 */

export interface RateLimitOptions {
  /** Max requests in the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

const hits = new Map<string, number[]>();

export function rateLimit(key: string, { limit, windowMs }: RateLimitOptions): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

/** Best-effort client IP from common proxy headers. */
export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Clear all buckets (tests only). */
export function resetRateLimits(): void {
  hits.clear();
}
