import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

export type UserRole = Enums<"user_role">;

export interface Viewer {
  id: string;
  username: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: UserRole;
  isVerifiedDet: boolean;
}

export function isSupabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * The signed-in user with their profile, or null for visitors.
 * Reads cookies ⇒ with Cache Components, call it inside a <Suspense> boundary.
 * Wrapped in React `cache` so it runs once per request however many components ask.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, full_name, avatar_url, role, is_verified_det")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return null;

  return {
    id: profile.id,
    username: profile.username,
    fullName: profile.full_name,
    avatarUrl: profile.avatar_url,
    role: profile.role,
    isVerifiedDet: profile.is_verified_det,
  };
});

/** For pages/actions that need a signed-in user. */
export async function requireViewer(nextPath = "/"): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return viewer;
}

/** For actions that need a Verified ΔΕΤ member (posting, starring). */
export async function requireVerifiedViewer(nextPath = "/"): Promise<Viewer> {
  const viewer = await requireViewer(nextPath);
  if (!viewer.isVerifiedDet) redirect("/settings/verify");
  return viewer;
}

/** For moderation pages. Moderators pass every role check. */
export async function requireRole(role: UserRole, nextPath = "/"): Promise<Viewer> {
  const viewer = await requireViewer(nextPath);
  if (!viewer.isVerifiedDet || (viewer.role !== role && viewer.role !== "moderator")) redirect("/");
  return viewer;
}
