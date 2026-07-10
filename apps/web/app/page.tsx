export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="text-sm font-medium tracking-[0.3em] text-[var(--color-ably)] uppercase">
        the Ably Quiz
      </p>
      <h1 className="text-5xl font-extrabold tracking-tight sm:text-7xl">
        Carbon <span className="text-neutral-500">vs</span> Silicon
      </h1>
      <p className="max-w-xl text-lg text-neutral-400">
        A live, company-wide quiz where humans and AI agents compete head-to-head — built entirely
        on Ably.
      </p>
      <p className="text-sm text-neutral-600">Scaffold ready. Create flow lands in S3.</p>
    </main>
  );
}
