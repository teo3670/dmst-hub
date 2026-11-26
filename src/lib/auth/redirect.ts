/**
 * Returns a same-site path to redirect to after sign-in, or "/".
 * Blocks open redirects such as "//evil.com", "/\\evil.com" or "https://evil.com".
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || typeof next !== "string") return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//") || next.startsWith("/\\")) return "/";
  // Reject control characters (e.g. "/\tevil.com" is normalised by browsers).
  if (/[\u0000-\u001f\u007f]/.test(next)) return "/";
  return next;
}
