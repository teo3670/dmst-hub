/**
 * Legacy Hall of Fame score (max 16.5).
 *
 * | Component                  | Rule                                               | Max  |
 * |----------------------------|----------------------------------------------------|------|
 * | GPA                        | the GPA itself (only if verified)                  | 10   |
 * | Projects & Open Source     | min(3, 0.5·log2(1 + stars) + 0.5·mergedPRs)        | 3    |
 * | Research lab               | 1.5 if verified participation / publication        | 1.5  |
 * | Teams & awards             | +1 team role, +1 award (both verified), cap 2      | 2    |
 *
 * Why log2 for stars: the first stars matter most and it stops a single viral
 * project from maxing the category (7 stars → 1.5, 63 stars → 3).
 *
 * The database has the identical function `public.legacy_score()`
 * (supabase/migrations/…_v1_1_legacy.sql). Change BOTH + the tests.
 */

export const LEGACY_WEIGHTS = {
  gpaMax: 10,
  openSourceMax: 3,
  openSourcePerLog2Star: 0.5,
  openSourcePerMergedPr: 0.5,
  researchLab: 1.5,
  teamRole: 1,
  award: 1,
  teamsAndAwardsMax: 2,
} as const;

export const LEGACY_MAX_SCORE =
  LEGACY_WEIGHTS.gpaMax +
  LEGACY_WEIGHTS.openSourceMax +
  LEGACY_WEIGHTS.researchLab +
  LEGACY_WEIGHTS.teamsAndAwardsMax; // 16.5

export interface LegacyInput {
  /** Degree GPA on the Greek 0–10 scale (graduates have ≥ 5). */
  gpa: number;
  gpaVerified: boolean;
  /** Total stars across projects the graduate is a member of (snapshot). */
  totalStars: number;
  /** Merged PRs to the DET Hub repo (snapshot). */
  mergedPrs: number;
  labVerified: boolean;
  teamRoleVerified: boolean;
  awardVerified: boolean;
}

export interface LegacyBreakdown {
  gpa: number;
  openSource: number;
  researchLab: number;
  teamsAndAwards: number;
  total: number;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function legacyScore(input: LegacyInput): LegacyBreakdown {
  const w = LEGACY_WEIGHTS;

  const gpa = input.gpaVerified ? clamp(input.gpa, 0, w.gpaMax) : 0;

  const stars = Math.max(0, Math.floor(input.totalStars));
  const prs = Math.max(0, Math.floor(input.mergedPrs));
  const openSource = Math.min(
    w.openSourceMax,
    w.openSourcePerLog2Star * Math.log2(1 + stars) + w.openSourcePerMergedPr * prs,
  );

  const researchLab = input.labVerified ? w.researchLab : 0;

  const teamsAndAwards = Math.min(
    w.teamsAndAwardsMax,
    (input.teamRoleVerified ? w.teamRole : 0) + (input.awardVerified ? w.award : 0),
  );

  return {
    gpa: round3(gpa),
    openSource: round3(openSource),
    researchLab,
    teamsAndAwards,
    total: round3(gpa + openSource + researchLab + teamsAndAwards),
  };
}
