import { afterEach, describe, expect, it } from "vitest";
import { clientIp, rateLimit, resetRateLimits } from "./rate-limit";

afterEach(() => {
  resetRateLimits();
});

describe("rateLimit", () => {
  it("allows up to the limit within the window", () => {
    expect(rateLimit("a", { limit: 2, windowMs: 60_000 })).toBe(true);
    expect(rateLimit("a", { limit: 2, windowMs: 60_000 })).toBe(true);
    expect(rateLimit("a", { limit: 2, windowMs: 60_000 })).toBe(false);
  });

  it("tracks keys independently", () => {
    expect(rateLimit("x", { limit: 1, windowMs: 60_000 })).toBe(true);
    expect(rateLimit("y", { limit: 1, windowMs: 60_000 })).toBe(true);
    expect(rateLimit("x", { limit: 1, windowMs: 60_000 })).toBe(false);
  });
});

describe("clientIp", () => {
  it("prefers the first x-forwarded-for hop", () => {
    expect(
      clientIp({
        headers: {
          get: (name) =>
            name === "x-forwarded-for" ? "1.2.3.4, 5.6.7.8" : null,
        },
      }),
    ).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip then unknown", () => {
    expect(
      clientIp({
        headers: { get: (name) => (name === "x-real-ip" ? "9.9.9.9" : null) },
      }),
    ).toBe("9.9.9.9");
    expect(clientIp({ headers: { get: () => null } })).toBe("unknown");
  });
});
