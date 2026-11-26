import { Suspense } from "react";
import { SignInButton } from "@/components/auth/SignInButton";
import { safeNextPath } from "@/lib/auth/redirect";

export const metadata = { title: "Σύνδεση" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">Σύνδεση στο DET Hub</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Συνδέεσαι με GitHub ώστε ο λογαριασμός σου να μείνει και μετά την αποφοίτηση. Στη συνέχεια
        επαληθεύεις μία φορά το ιδρυματικό σου email για να πάρεις το badge «Verified ΔΕΤ».
      </p>
      <Suspense fallback={<SignInButton />}>
        <LoginButton searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function LoginButton({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { next } = await searchParams;
  return <SignInButton next={safeNextPath(Array.isArray(next) ? next[0] : next)} />;
}
