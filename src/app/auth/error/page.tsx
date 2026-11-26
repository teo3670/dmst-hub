import Link from "next/link";

export const metadata = { title: "Πρόβλημα σύνδεσης" };

export default function AuthErrorPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">Η σύνδεση δεν ολοκληρώθηκε</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Ίσως ακύρωσες την έγκριση στο GitHub ή ο σύνδεσμος έληξε. Δοκίμασε ξανά. Αν το πρόβλημα
        συνεχίζεται, άνοιξε ένα issue στο GitHub του project.
      </p>
      <Link href="/login" className="font-medium underline underline-offset-4">
        Δοκίμασε ξανά
      </Link>
    </main>
  );
}
