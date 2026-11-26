"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { publicEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

/** Where the browser should come back to. Works on localhost and on Vercel previews. */
async function siteOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) return `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
  return publicEnv().NEXT_PUBLIC_SITE_URL;
}

export async function signInWithGitHub(formData: FormData) {
  const next = safeNextPath(formData.get("next")?.toString());
  const supabase = await createClient();

  const callback = new URL("/auth/callback", await siteOrigin());
  callback.searchParams.set("next", next);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: callback.toString(),
      // read:user is enough for name, avatar and public repos.
      scopes: "read:user",
    },
  });

  if (error || !data.url) redirect("/auth/error?reason=oauth_start");
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
