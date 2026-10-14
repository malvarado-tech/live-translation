import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <main className="mx-auto w-full max-w-2xl px-6 py-16 text-zinc-900 dark:text-zinc-100">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-400">
          Live translation
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Real-time speech translation for live events
        </h1>
        <p className="mt-4 text-base leading-7 text-zinc-600 dark:text-zinc-400">
          One speaker, one realtime translation session, many listeners. The
          operator dashboard sends the speaker&apos;s audio to a realtime speech
          model and republishes the translated audio through LiveKit to
          listeners&apos; phones.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/operator"
            className="flex h-11 items-center justify-center rounded-md bg-emerald-600 px-6 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-950"
          >
            Open operator dashboard →
          </Link>
        </div>

        <p className="mt-12 text-xs text-zinc-500 dark:text-zinc-500">
          Minimal version · gpt-realtime-translate · LiveKit
        </p>
      </main>
    </div>
  );
}
