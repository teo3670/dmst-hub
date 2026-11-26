import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session on every request and writes the new auth
 * cookies to both the request (for Server Components) and the response
 * (for the browser). Called from src/proxy.ts.
 *
 * This is NOT authorization: pages and Server Actions still check the user
 * themselves (src/lib/auth/session.ts), and RLS protects the data.
 */
export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Without env vars (e.g. a fresh clone) just render the public site.
  if (!url || !anonKey) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        // Auth cookies must never be cached by a CDN (would leak sessions).
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Do not put code between createServerClient and getClaims():
  // getClaims() validates the JWT and triggers the refresh if needed.
  await supabase.auth.getClaims();

  return response;
}
