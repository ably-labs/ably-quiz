'use client';

// The front door (§S5.2). A calm landing — hero + two clear paths (host / join) —
// instead of dropping straight into the create grid (which now lives at /create).
// Stays inside the one dark theme: near-black canvas, a single Ably-orange accent.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Staggered page-load reveal, reusing the podium-rise keyframe. */
const rise = (delay: number) => ({ animation: `podium-rise 0.5s ease-out ${delay}s both` });

export default function LandingPage() {
  const router = useRouter();
  const [code, setCode] = useState('');

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    if (c) router.push(`/play?quiz=${encodeURIComponent(c)}`);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
      <div style={rise(0)}>
        <p className="text-xs font-semibold tracking-[0.35em] text-ably uppercase">the Ably Quiz</p>
        <h1 className="mt-3 text-5xl font-extrabold tracking-tight sm:text-7xl">
          Carbon <span className="text-neutral-600">vs</span> Silicon
        </h1>
        <p className="mx-auto mt-4 max-w-md text-balance text-neutral-400">
          A live quiz where your colleagues take on a field of AI agents — head-to-head, same
          questions, same clock. Built entirely on Ably.
        </p>
      </div>

      <div className="mt-10 w-full" style={rise(0.1)}>
        <HeroArt />
      </div>

      <div className="mt-10 flex w-full flex-col items-center gap-4" style={rise(0.2)}>
        <Link
          href="/create"
          className="w-full max-w-xs rounded-xl bg-ably px-6 py-4 text-lg font-bold text-black transition hover:brightness-110"
        >
          Host a quiz →
        </Link>

        <form onSubmit={join} className="flex w-full max-w-xs items-center gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter a quiz code"
            aria-label="Quiz code"
            className="min-w-0 flex-1 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-center text-ink placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-xl border border-neutral-700 px-4 py-3 font-semibold text-ink transition hover:border-neutral-500"
          >
            Join
          </button>
        </form>
        <p className="text-xs text-neutral-600">Joining? Your host shares a code or QR.</p>
      </div>
    </main>
  );
}

/** The hero art — Carbon (a sweating brain) arm-wrestling Silicon (a smug chip).
 *  The periodic "C vs Si" placeholder sits behind it as a graceful fallback if
 *  the asset is ever missing. */
function HeroArt() {
  return (
    <div className="relative mx-auto aspect-[16/9] w-full max-w-2xl overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950">
      <HeroPlaceholder />
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: 'url(/hero.webp)' }}
        role="img"
        aria-label="Carbon vs Silicon — a brain arm-wrestles a microchip"
      />
    </div>
  );
}

function HeroPlaceholder() {
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-5 bg-[radial-gradient(circle_at_50%_60%,rgba(255,84,22,0.12),transparent_70%)] sm:gap-8">
      <ElementBadge symbol="C" name="Carbon" />
      <span className="text-xl font-black text-ably sm:text-2xl">vs</span>
      <ElementBadge symbol="Si" name="Silicon" />
    </div>
  );
}

function ElementBadge({ symbol, name }: { symbol: string; name: string }) {
  return (
    <div className="flex h-24 w-24 flex-col items-center justify-center rounded-2xl border border-neutral-700 bg-neutral-900/60 sm:h-32 sm:w-32">
      <span className="text-4xl font-extrabold tracking-tight sm:text-5xl">{symbol}</span>
      <span className="mt-1 text-[0.6rem] tracking-[0.2em] text-neutral-500 uppercase">{name}</span>
    </div>
  );
}
