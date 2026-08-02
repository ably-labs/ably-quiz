'use client';

// /test — "Stump the agents" (§S7.4). Self-serve question workshop for round
// two: write a candidate question, fire it at the whole roster at once, and see
// which agents it beats before you submit it.
//
// Staff-only by construction: the page is gated behind the same MCP OAuth the
// host uses (useMcpAuth), and /api/agent-test refuses without that token. The
// token lives in this browser's sessionStorage only and is passed per request.
//
// Nothing here touches a quiz: no Ably channel, no state, nothing stored.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { useMcpAuth } from '@/hooks/useMcpAuth';

const LETTERS = ['A', 'B', 'C', 'D'] as const;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;

/** Scope for the sessionStorage token + the OAuth round trip. Not a quiz id —
 *  the tester's token is deliberately kept separate from any live quiz. */
const AUTH_SCOPE = 'stump-the-agents';

type ToolCall = {
  name: string;
  input?: string;
  result?: string;
  ms?: number;
  isError?: boolean;
};

type AgentResult = {
  slug: string;
  name: string;
  emoji: string;
  model: string;
  provider: string;
  choice: string | null;
  correct?: boolean;
  toolCalls: ToolCall[];
  thinking: string;
  totalMs: number | null;
  timedOut: boolean;
  forcedGuess: boolean;
  error?: string;
};

type TestResponse = {
  correctLetter?: string;
  results: AgentResult[];
  summary: { agents: number; stumped?: number };
};

export default function StumpPage() {
  const mcp = useMcpAuth(AUTH_SCOPE);
  // ABLY_MCP_URL is server-only, so ask the same status endpoint the host uses.
  const [groundingAvailable, setGroundingAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    void fetch('/api/mcp/status')
      .then((r) => (r.ok ? r.json() : { configured: false }))
      .then((d: { configured?: boolean }) => setGroundingAvailable(Boolean(d.configured)))
      .catch(() => setGroundingAvailable(false));
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <BrandMark className="mb-5" />
      <header className="mb-6">
        <p className="text-xs tracking-widest text-neutral-500 uppercase">round two</p>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">🎯 Stump the agents</h1>
        <p className="mt-2 text-neutral-400">
          Try a candidate question against the full agent roster before you submit it. Every agent
          answers at once, grounded on our company knowledge — exactly as it will on the night.
        </p>
      </header>

      <Guidance />

      {groundingAvailable === false ? (
        <Notice>
          Agent grounding isn’t configured on this deployment, so questions can’t be tested here.
        </Notice>
      ) : mcp.status === 'authed' && mcp.token ? (
        <Tester token={mcp.token} onSignOut={mcp.signOut} />
      ) : (
        <SignInGate
          busy={mcp.status === 'starting' || mcp.status === 'exchanging'}
          error={mcp.error}
          onAuthenticate={mcp.authenticate}
        />
      )}

      <p className="mt-10 text-sm text-neutral-600">
        <Link href="/" className="underline hover:text-neutral-400">
          ← back to the quiz
        </Link>
      </p>
    </main>
  );
}

/** The brief, in one box: what the agents can already reach, and therefore where
 *  a winning question has to live. */
function Guidance() {
  return (
    <section className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
      <h2 className="mb-2 text-sm tracking-widest text-neutral-500 uppercase">
        What beats a machine
      </h2>
      <p className="text-sm leading-relaxed text-neutral-300">
        We’re a remote-first, written-first company — the agents have read Confluence, Jira, Slack,
        Gong and the dashboards. If a question is <em>written down anywhere</em>, they’ll find it.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-neutral-300">
        True, verifiable, but undocumented —{' '}
        <span className="text-ably">that’s the winning space</span>. And it still has to be
        checkable by a human, so keep the answer something a colleague can confirm.
      </p>
    </section>
  );
}

/** Not signed in: explain why, then the same Okta round trip the host runs. The
 *  redirect comes back to this exact URL, and useMcpAuth completes the exchange
 *  on mount (it looks for ?code&state on whatever page it's mounted on). */
function SignInGate({
  busy,
  error,
  onAuthenticate,
}: {
  busy: boolean;
  error?: string;
  onAuthenticate: () => void;
}) {
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
      <h2 className="text-lg font-bold">Sign in to test a question</h2>
      <p className="mt-2 text-sm leading-relaxed text-neutral-400">
        The agents answer using our company knowledge over MCP, so testing needs your company
        sign-in. Read-only, this browser session only — and the agents only ever see what{' '}
        <em>you</em> can already see.
      </p>
      {error && <p className="mt-3 text-sm text-red-400">⚠️ {error}</p>}
      <button
        type="button"
        onClick={onAuthenticate}
        disabled={busy}
        className="mt-4 rounded-lg bg-ably px-5 py-3 font-semibold text-black transition hover:brightness-110 disabled:opacity-40"
      >
        {busy ? 'Connecting…' : 'Sign in with your company account'}
      </button>
    </section>
  );
}

/** The form + results, once we hold a token. */
function Tester({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const [prompt, setPrompt] = useState('');
  const [options, setOptions] = useState<string[]>(['', '', '', '']);
  const [correctIndex, setCorrectIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [response, setResponse] = useState<TestResponse | null>(null);

  const filled = options.map((o) => o.trim());
  const usable = filled.filter(Boolean).length;
  const ready =
    prompt.trim().length > 0 &&
    usable >= MIN_OPTIONS &&
    Boolean(filled[correctIndex]) &&
    // No gaps: options must be contiguous from the top, so the letters the
    // agents see match the letters shown here.
    filled.slice(0, usable).every(Boolean);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || running) return;
    setRunning(true);
    setError(undefined);
    setResponse(null);
    try {
      const res = await fetch('/api/agent-test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: { prompt: prompt.trim(), options: filled.slice(0, usable), correctIndex },
          mcpToken: token,
        }),
      });
      const data = (await res.json()) as TestResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'the test run failed');
    } finally {
      setRunning(false);
    }
  };

  const setOption = (i: number, value: string) =>
    setOptions((prev) => prev.map((o, j) => (j === i ? value : o)));

  return (
    <>
      <form
        onSubmit={run}
        className="space-y-5 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6"
      >
        <div>
          <label htmlFor="prompt" className="mb-1 block text-sm font-semibold text-neutral-300">
            Your question
          </label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="e.g. Which of these did we nearly call the company before settling on Ably?"
            className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-ink placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
          />
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-neutral-300">
            Options{' '}
            <span className="font-normal text-neutral-500">
              — {MIN_OPTIONS}–{MAX_OPTIONS}, and mark the correct one
            </span>
          </legend>
          <div className="space-y-2">
            {options.map((value, i) => {
              const letter = LETTERS[i];
              return (
                <div key={letter} className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="correct"
                    checked={correctIndex === i}
                    onChange={() => setCorrectIndex(i)}
                    disabled={!value.trim()}
                    aria-label={`Option ${letter} is correct`}
                    className="h-4 w-4 shrink-0 accent-emerald-500 disabled:opacity-30"
                  />
                  <span className="w-5 shrink-0 font-mono text-sm text-neutral-500">{letter}</span>
                  <input
                    value={value}
                    onChange={(e) => setOption(i, e.target.value)}
                    placeholder={i < MIN_OPTIONS ? 'required' : 'optional'}
                    aria-label={`Option ${letter}`}
                    className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-ink placeholder:text-neutral-700 focus:border-neutral-600 focus:outline-none"
                  />
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-neutral-600">
            The radio marks the true answer — that’s how we score who got stumped.
          </p>
        </fieldset>

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={!ready || running}
            className="rounded-lg bg-ably px-5 py-3 font-semibold text-black transition hover:brightness-110 disabled:opacity-40"
          >
            {running ? 'Asking the agents…' : 'Ask the agents →'}
          </button>
          <p className="text-sm text-neutral-500">
            {running
              ? 'Every agent is answering at once — sit tight.'
              : 'Runs the whole roster in parallel; takes 10–25 seconds.'}
          </p>
          <button
            type="button"
            onClick={onSignOut}
            className="ml-auto text-xs text-neutral-600 underline hover:text-neutral-400"
          >
            sign out
          </button>
        </div>
      </form>

      {error && (
        <div className="mt-6">
          <Notice>{error}</Notice>
        </div>
      )}
      {running && <RunningPanel />}
      {response && !running && <Results response={response} />}
    </>
  );
}

/** Something to watch during the ~20s wait. */
function RunningPanel() {
  return (
    <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 text-center">
      <p className="animate-pulse text-neutral-300">🤖 The agents are thinking…</p>
      <p className="mt-1 text-sm text-neutral-600">
        They’re searching the company’s written record before they answer.
      </p>
    </div>
  );
}

function Results({ response }: { response: TestResponse }) {
  const { results, summary, correctLetter } = response;
  const scored = summary.stumped !== undefined;
  const stumped = summary.stumped ?? 0;
  const total = summary.agents;

  return (
    <section className="mt-8">
      {scored && (
        <div
          className={`mb-6 rounded-2xl border p-6 text-center ${
            stumped > 0
              ? 'border-emerald-800/60 bg-emerald-950/30'
              : 'border-amber-800/60 bg-amber-950/30'
          }`}
        >
          {stumped > 0 ? (
            <>
              <p className="text-2xl font-extrabold">
                You stumped {stumped} of {total} agents 🎉
              </p>
              <p className="mt-1 text-sm text-neutral-400">
                {stumped === total
                  ? 'A clean sweep — this one belongs in round two.'
                  : 'Promising. Tighten the distractors and see if you can take the rest.'}
              </p>
            </>
          ) : (
            <>
              <p className="text-2xl font-extrabold">
                The agents got it — {total}/{total} correct.
              </p>
              <p className="mt-1 text-sm text-neutral-400">
                Back to the drawing board: this one is written down somewhere they can reach.
              </p>
            </>
          )}
        </div>
      )}

      <h2 className="mb-3 text-sm tracking-widest text-neutral-500 uppercase">
        What each agent did
        {correctLetter && <span className="normal-case"> · answer was {correctLetter}</span>}
      </h2>
      <div className="space-y-3">
        {results.map((r) => (
          <AgentCard key={r.slug} result={r} />
        ))}
      </div>
    </section>
  );
}

function AgentCard({ result: r }: { result: AgentResult }) {
  return (
    <article className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xl" aria-hidden>
          {r.emoji}
        </span>
        <span className="font-semibold">{r.name}</span>
        <span className="truncate font-mono text-xs text-neutral-600">{r.model}</span>
        <span className="ml-auto text-xs text-neutral-500">{fmtMs(r.totalMs)}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-neutral-800 px-2 py-0.5 font-mono text-neutral-200">
          {r.choice ?? 'no answer'}
        </span>
        {r.correct === true && (
          <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-emerald-400">✓ correct</span>
        )}
        {r.correct === false && (
          <span className="rounded bg-rose-950 px-1.5 py-0.5 text-rose-400">✗ stumped</span>
        )}
        {r.timedOut && (
          <span className="rounded bg-amber-950 px-1.5 py-0.5 text-amber-400">timed out</span>
        )}
        {r.forcedGuess && (
          <span className="rounded bg-amber-950/60 px-1.5 py-0.5 text-amber-300">forced guess</span>
        )}
        {r.error && <span className="rounded bg-rose-950 px-1.5 py-0.5 text-rose-400">failed</span>}
      </div>

      {r.error && <p className="mt-2 text-sm text-amber-300/80">{r.error}</p>}

      {r.thinking && (
        <p className="mt-3 line-clamp-3 text-sm text-neutral-300 italic">“{excerpt(r.thinking)}”</p>
      )}

      {r.toolCalls.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1 text-xs tracking-wide text-neutral-500 uppercase">
            Tool calls · {r.toolCalls.length}
          </p>
          <div className="space-y-2">
            {r.toolCalls.map((c, i) => (
              <ToolCallRow key={i} call={c} />
            ))}
          </div>
        </div>
      ) : (
        !r.error && (
          <p className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-500">
            🔌 No tool calls — it answered from its own knowledge.
          </p>
        )
      )}
    </article>
  );
}

function ToolCallRow({ call: c }: { call: ToolCall }) {
  return (
    <div
      className={`rounded-lg border p-2 font-mono text-xs ${
        c.isError ? 'border-rose-900/60 bg-rose-950/20' : 'border-neutral-800 bg-neutral-950'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-ably">{c.name}</span>
        {typeof c.ms === 'number' && <span className="text-neutral-500">{fmtMs(c.ms)}</span>}
        {c.isError && <span className="text-rose-400">error</span>}
      </div>
      {c.input && <p className="mt-1 break-words text-neutral-500">in: {excerpt(c.input, 200)}</p>}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
      ⚠️ {children}
    </div>
  );
}

/** Format a millisecond latency compactly (`820ms` / `3.4s`), matching the quiz UI. */
function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function excerpt(text: string, max = 280): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
