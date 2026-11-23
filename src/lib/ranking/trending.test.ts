import { describe, expect, it } from "vitest";
import { sortByTrending, trendingScore } from "./trending";

const now = new Date("2026-11-24T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

describe("trendingScore", () => {
  it("matches the formula stars / (h + 2)^1.8", () => {
    expect(trendingScore({ stars: 10, launchedAt: now }, now)).toBeCloseTo(10 / 2 ** 1.8, 10);
    expect(trendingScore({ stars: 10, launchedAt: hoursAgo(10) }, now)).toBeCloseTo(10 / 12 ** 1.8, 10);
  });

  it("is 0 for projects without stars", () => {
    expect(trendingScore({ stars: 0, launchedAt: now }, now)).toBe(0);
  });

  it("lets a fresh project beat an older one with more stars", () => {
    const fresh = trendingScore({ stars: 5, launchedAt: hoursAgo(3) }, now);
    const old = trendingScore({ stars: 50, launchedAt: hoursAgo(24 * 14) }, now);
    expect(fresh).toBeGreaterThan(old);
  });

  it("treats future launch dates as 'just launched'", () => {
    const future = new Date(now.getTime() + 3_600_000);
    expect(trendingScore({ stars: 4, launchedAt: future }, now)).toBe(trendingScore({ stars: 4, launchedAt: now }, now));
  });
});

describe("sortByTrending", () => {
  it("orders by score and does not mutate the input", () => {
    const input = [
      { id: "old", stars: 40, launchedAt: hoursAgo(24 * 30) },
      { id: "hot", stars: 8, launchedAt: hoursAgo(5) },
      { id: "new", stars: 1, launchedAt: hoursAgo(1) },
    ];
    const sorted = sortByTrending(input, now);
    expect(sorted.map((p) => p.id)).toEqual(["hot", "new", "old"]);
    expect(input[0].id).toBe("old");
  });
});
