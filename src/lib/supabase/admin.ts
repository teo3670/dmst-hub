import "server-only";

import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/**
 * ⚠️ Service-role client: BYPASSES Row Level Security.
 *
 * Use it only on the server, only for things a user must never do directly:
 * writing OTP codes, marking an account as Verified ΔΕΤ, recording merged PRs.
 * Always check who the caller is (with the normal server client) BEFORE using it.
 * The `server-only` import makes the build fail if a Client Component imports this file.
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set (server-only env var).");
  }
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
