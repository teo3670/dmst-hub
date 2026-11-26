import { z } from "zod";

/**
 * Public env vars (safe in the browser). They must be referenced literally
 * (process.env.NEXT_PUBLIC_…) so Next.js can inline them at build time.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
});

let cached: z.infer<typeof publicSchema> | undefined;

export function publicEnv() {
  if (cached) return cached;
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
  });
  if (!parsed.success) {
    throw new Error(
      "Missing or invalid Supabase env vars. Copy .env.example to .env.local and fill it in " +
        "(see CONTRIBUTING.md → «Στήσιμο σε 5 λεπτά»).\n" +
        z.prettifyError(parsed.error),
    );
  }
  cached = parsed.data;
  return cached;
}
