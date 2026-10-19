import Link from "next/link";
import { buttonClass } from "@/components/ui/controls";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-4 py-16">
      <div>
        <p className="font-cond text-lg font-semibold tracking-[0.04em] text-silk">Live translation</p>
        <h1 className="mt-2 text-4xl font-bold leading-tight text-ink sm:text-5xl">
          Real-time speech translation for live events
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-silk">
          One speaker, one translation channel per language, many listeners. The operator dashboard
          sends the speaker&apos;s audio to a realtime speech model and republishes the translated
          audio and captions through LiveKit to listeners&apos; phones.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link href="/operator" className={buttonClass("primary", "lg")}>
          Operator dashboard
        </Link>
        <Link href="/replay" className={buttonClass("default", "lg")}>
          Listener replay
        </Link>
        <Link href="/replay/operator" className={buttonClass("ghost", "lg")}>
          Operator replay
        </Link>
      </div>
      <p className="text-[15px] text-silk">
        The replays play a recorded 1962 speech with AI-generated translation and voice; they need
        no keys and no server.
      </p>
    </main>
  );
}
