import { describe, expect, it } from "vitest";
import { LEGACY_MAX_SCORE, legacyScore, type LegacyInput } from "./score";

const base: LegacyInput = {
  gpa: 8.73,
  gpaVerified: true,
  totalStars: 0,
  mergedPrs: 0,
  labVerified: false,
  teamRoleVerified: false,
  awardVerified: false,
};

describe("legacyScore", () => {
  it("has a maximum of 16.5", () => {
    expect(LEGACY_MAX_SCORE).toBe(16.5);
    const max = legacyScore({ ...base, gpa: 10, totalStars: 10_000, mergedPrs: 50, labVerified: true, teamRoleVerified: true, awardVerified: true });
    expect(max.total).toBe(16.5);
  });

  it("counts GPA only when verified", () => {
    expect(legacyScore(base).gpa).toBe(8.73);
    expect(legacyScore({ ...base, gpaVerified: false }).gpa).toBe(0);
  });

  it("gives diminishing returns for stars and caps open source at 3", () => {
    expect(legacyScore({ ...base, totalStars: 7 }).openSource).toBe(1.5);
    expect(legacyScore({ ...base, totalStars: 63 }).openSource).toBe(3);
    expect(legacyScore({ ...base, totalStars: 3, mergedPrs: 2 }).openSource).toBe(2);
    expect(legacyScore({ ...base, mergedPrs: 100 }).openSource).toBe(3);
  });

  it("caps teams & awards at 2", () => {
    expect(legacyScore({ ...base, teamRoleVerified: true }).teamsAndAwards).toBe(1);
    expect(legacyScore({ ...base, teamRoleVerified: true, awardVerified: true }).teamsAndAwards).toBe(2);
  });

  // Same case as the SQL test (supabase/tests/rls.mjs) → keeps TS and SQL in sync.
  it("matches the database example: 14.23", () => {
    const r = legacyScore({ ...base, totalStars: 3, mergedPrs: 2, labVerified: true, teamRoleVerified: true, awardVerified: true });
    expect(r.total).toBe(14.23);
  });

  it("never goes negative on bad input", () => {
    const r = legacyScore({ ...base, gpa: -3, totalStars: -10, mergedPrs: -1 });
    expect(r.total).toBe(0);
  });
});
