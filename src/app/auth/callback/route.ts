import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * GitHub → Supabase → here with ?code=…
 * Exchanges the one-time code for a session (sets the auth cookies) and sends
 * the user back where they started. The profile row is created by the
 * `on_auth_user_created` trigger in the database.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }

  const reason = searchParams.get("error") ? "denied" : "exchange_failed";
  return NextResponse.redirect(new URL(`/auth/error?reason=${reason}`, origin));
}
