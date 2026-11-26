export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Τι φτιάχνουν οι φοιτητές του ΔΕΤ</h1>
      <p className="max-w-2xl text-zinc-600 dark:text-zinc-400">
        Projects ανά έτος σπουδών, ερευνητικά εργαστήρια, φοιτητικές ομάδες και δράσεις, όλα σε
        ένα μέρος. Τα Trending projects έρχονται στη Φάση 4 του roadmap (docs/ROADMAP.md).
      </p>
    </main>
  );
}
