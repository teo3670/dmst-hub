/**
 * Trending score — Hacker News–style time decay.
 *
 *   score = stars / (hoursSinceLaunch + 2) ^ gravity
 *
 * - `+ 2` keeps brand-new projects from dividing by ~0 and stops a project
 *   with 1 star in its first minute from beating everything.
 * - Higher `gravity` ⇒ old projects sink faster. 1.8 is the HN default.
 *
 * The database computes the same thing in `public.trending_score()`
 * (supabase/migrations/…_mvp_core.sql) so we can ORDER BY it in SQL.
 * If you change the formula, change BOTH and update the tests.
 */

export const TRENDING_GRAVITY = 1.8;
export const TRENDING_OFFSET_HOURS = 2;

const MS_PER_HOUR = 60 * 60 * 1000;

export interface TrendingInput {
  stars: number;
  launchedAt: Date | string;
}

export function hoursSince(date: Date | string, now: Date = new Date()): number {
  const launched = typeof date === "string" ? new Date(date) : date;
  return Math.max(0, (now.getTime() - launched.getTime()) / MS_PER_HOUR);
}

export function trendingScore(
  { stars, launchedAt }: TrendingInput,
  now: Date = new Date(),
  gravity: number = TRENDING_GRAVITY,
): number {
  const safeStars = Math.max(0, stars);
  return safeStars / Math.pow(hoursSince(launchedAt, now) + TRENDING_OFFSET_HOURS, gravity);
}

/** Sorts a copy of `projects` by trending score (desc), newest first on ties. */
export function sortByTrending<T extends TrendingInput>(projects: readonly T[], now: Date = new Date()): T[] {
  return projects
    .map((p) => ({ p, score: trendingScore(p, now), t: new Date(p.launchedAt).getTime() }))
    .sort((a, b) => b.score - a.score || b.t - a.t)
    .map(({ p }) => p);
}
