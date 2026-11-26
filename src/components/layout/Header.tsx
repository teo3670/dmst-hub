import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/actions/auth";
import { SignInButton } from "@/components/auth/SignInButton";
import { getViewer, isSupabaseConfigured } from "@/lib/auth/session";

export function Header() {
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
        <Link href="/" className="font-semibold tracking-tight">
          DET Hub
        </Link>
        {/* The static part of the header prerenders; only the user menu waits for the request. */}
        <Suspense fallback={<div className="h-8 w-32 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800" />}>
          <UserMenu />
        </Suspense>
      </div>
    </header>
  );
}

async function UserMenu() {
  if (!isSupabaseConfigured()) {
    return <span className="text-xs text-zinc-500">Supabase δεν έχει ρυθμιστεί (.env.local)</span>;
  }

  const viewer = await getViewer();
  if (!viewer) return <SignInButton />;

  return (
    <div className="flex items-center gap-3 text-sm">
      {viewer.isVerifiedDet ? (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100">
          Verified ΔΕΤ
        </span>
      ) : (
        <span className="text-xs text-zinc-500">Μη επαληθευμένος</span>
      )}
      <span className="flex items-center gap-2">
        {viewer.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- tiny GitHub avatar, no optimisation needed
          <img src={viewer.avatarUrl} alt="" width={24} height={24} className="h-6 w-6 rounded-full" />
        )}
        <span className="font-medium">{viewer.username}</span>
      </span>
      <form action={signOut}>
        <button type="submit" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
          Αποσύνδεση
        </button>
      </form>
    </div>
  );
}
