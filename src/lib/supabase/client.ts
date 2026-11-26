import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components ("use client").
 * Prefer Server Components + Server Actions; use this only for
 * browser-only features (e.g. realtime, optimistic UI).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
