import { describe, expect, it } from "vitest";
import { safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it.each([
    ["/projects/abc", "/projects/abc"],
    ["/new?draft=1", "/new?draft=1"],
    [null, "/"],
    ["", "/"],
    ["projects", "/"],
    ["https://evil.com", "/"],
    ["//evil.com", "/"],
    ["/\\evil.com", "/"],
    ["/\tevil.com", "/"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
