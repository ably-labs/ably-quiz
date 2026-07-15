'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { JoinQr } from '@/components/JoinQr';
import { Lobby } from '@/components/Lobby';
import {
  AgentTranscripts,
  Countdown,
  CounterfactualPanel,
  ExternalLinkIcon,
  LETTERS,
  QuestionCard,
  QuizProgress,
  Scoreboard,
  TallyBars,
  TeamMark,
} from '@/components/quiz';
import { useAbly } from '@/hooks/useAbly';
import { useAgentHealth, type HealthState } from '@/hooks/useAgentHealth';
import { useHostQuiz } from '@/hooks/useHostQuiz';
import { useMcpAuth, type McpAuth } from '@/hooks/useMcpAuth';
import { useQuizId } from '@/hooks/useQuizId';
import { loadQuiz } from '@/lib/quiz-storage';

export default function HostPage() {
  const quizId = useQuizId();
  const quiz = useMemo(() => (typeof quizId === 'string' ? loadQuiz(quizId) : null), [quizId]);
  const params = typeof quizId === 'string' && quiz ? { quizId, role: 'host' as const } : null;
  const { status, conn, error } = useAbly(params);
  const mcpAuth = useMcpAuth(typeof quizId === 'string' ? quizId : null);
  // Is MCP grounding configured on the server? (ABLY_MCP_URL — a server-only var,
  // so the client asks a tiny status endpoint.) Unset ⇒ hide the grounding UI
  // entirely: agents just play on their own knowledge (§S6.5).
  const [groundingAvailable, setGroundingAvailable] = useState(false);
  useEffect(() => {
    void fetch('/api/mcp/status')
      .then((r) => (r.ok ? r.json() : { configured: false }))
      .then((d: { configured?: boolean }) => setGroundingAvailable(Boolean(d.configured)))
      .catch(() => undefined);
  }, []);
  const agentSlugs = useMemo(() => quiz?.config.agents?.map((a) => a.slug) ?? [], [quiz]);
  const health = useAgentHealth(agentSlugs);
  // Agents that failed the preflight: greyed out in the roster + excluded from
  // the answer count / turn-firing, so a dead model can't stall the quiz (§S5.2).
  const unavailable = useMemo(
    () => new Set(health.results.filter((r) => !r.ok).map((r) => r.slug)),
    [health.results],
  );
  const {
    state,
    correct,
    question,
    live,
    controls,
    answersIn,
    expectedAnswerers,
    busy,
    members,
    counterfactual,
    agentTranscripts,
  } = useHostQuiz(conn, quiz, mcpAuth.token, unavailable);

  if (quizId === undefined) return <Centered>Loading…</Centered>;
  if (quizId === null) return <Centered>No quiz specified.</Centered>;
  if (!quiz)
    return <Centered>Open host controls from the machine that created this quiz.</Centered>;

  const total = quiz.questions.length;
  const qLabel = state.questionIdx >= 0 ? `Q${state.questionIdx + 1} / ${total}` : '';
  const isLast = state.questionIdx + 1 >= total;

  const asking = state.phase === 'asking';
  const locked = state.phase === 'locked';
  const revealed = state.phase === 'revealed';
  const ended = state.phase === 'podium' || state.phase === 'analysis' || state.phase === 'done';
  const showQuestion = (asking || locked || revealed) && question;

  // Denominator = expected answerers (humans present + declared agents), and the
  // count is the engine's per-idx tally — so it reads right for on-demand agents,
  // which answer via /api/agent-turn without entering presence (§S4.4).
  const roster = expectedAnswerers;
  const answered = answersIn;
  const correctText = correct ? question?.options[LETTERS.indexOf(correct)] : undefined;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <BrandMark className="mb-5" />
      <header className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs tracking-widest text-neutral-500 uppercase">host controls</p>
          <h1 className="text-2xl font-bold">{quizId}</h1>
        </div>
        <div className="flex items-center gap-4">
          {/* Compact Carbon-vs-Silicon identity, balanced against the status block (§S5.2). */}
          <div className="flex items-center gap-1.5" aria-label="Carbon vs Silicon">
            <TeamMark team="carbon" className="h-8 w-8" />
            <span className="text-[0.65rem] font-bold text-neutral-600">vs</span>
            <TeamMark team="silicon" className="h-8 w-8" />
          </div>
          <div className="text-right text-sm text-neutral-500">
            <div>
              connection: <span className="font-medium text-neutral-300">{status}</span>
            </div>
            <div>
              phase: <span className="font-medium text-neutral-300">{state.phase}</span> {qLabel}
            </div>
          </div>
        </div>
      </header>
      {error && <p className="mb-4 text-sm text-red-400">⚠️ {error}</p>}

      {state.questionIdx >= 0 && !ended && (
        <div className="mb-6">
          <QuizProgress current={state.questionIdx + 1} total={total} />
        </div>
      )}

      {/* Once the quiz starts, keep the chrome quiet: the grounding/health banners
          only show in the lobby, or in-game when there's a genuine problem (§S5.2). */}
      {(state.phase === 'lobby' ||
        health.status === 'issues' ||
        health.status === 'unconfigured') && <AgentHealthBanner health={health} />}
      {state.phase === 'lobby' && groundingAvailable && (
        <McpAuthBanner mcp={mcpAuth} quizId={quizId} />
      )}

      {state.phase === 'lobby' && <HostShare quizId={quizId} />}

      {showQuestion && (
        <section className="mb-6 space-y-5 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
          <div className="flex items-start justify-between gap-6">
            <div className="flex-1">
              <QuestionCard prompt={question.prompt} />
            </div>
            {(asking || locked) && (
              <div className="shrink-0">
                <Countdown startedAt={question.startedAt} limitMs={question.limitMs} />
              </div>
            )}
          </div>

          {correct && (
            <p className="text-sm text-neutral-400">
              Answer: <span className="font-semibold text-emerald-400">{correct}</span>
              {correctText ? ` — ${correctText}` : ''}{' '}
              <span className="text-neutral-600">(host only — not shown to players)</span>
            </p>
          )}

          <TallyBars
            options={question.options}
            tallies={live.tallies}
            correct={revealed ? correct : null}
          />

          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-400">
              <span className="font-semibold text-neutral-200 tabular-nums">{answered}</span> of{' '}
              {roster} answered
            </span>
            {locked && <span className="text-amber-400">answers locked</span>}
            {revealed && <span className="text-emerald-400">revealed</span>}
          </div>
        </section>
      )}

      <div className="mb-8 flex flex-wrap gap-3">
        {state.phase === 'lobby' && (
          <StartControls
            hasAgents={(quiz.config.agents?.length ?? 0) > 0}
            groundingAvailable={groundingAvailable}
            grounded={mcpAuth.status === 'authed'}
            busy={busy}
            disabled={total === 0}
            onStart={controls.next}
            onAuthenticate={mcpAuth.authenticate}
          />
        )}
        {asking && (
          <Control onClick={controls.lock} busy={busy} primary>
            Lock answers ({answered}/{roster})
          </Control>
        )}
        {locked && (
          <Control onClick={controls.reveal} busy={busy} primary>
            Reveal answer
          </Control>
        )}
        {revealed && (
          <>
            {!isLast && (
              <Control onClick={controls.next} busy={busy} primary>
                Next question →
              </Control>
            )}
            <Control onClick={controls.podium} busy={busy} primary={isLast}>
              {isLast ? 'Finish → podium' : 'End early → podium'}
            </Control>
          </>
        )}
        {state.phase === 'podium' && (
          <p className="text-neutral-400">Podium up — the AI’s verdict is streaming in…</p>
        )}
        {(state.phase === 'analysis' || state.phase === 'done') && (
          <div className="flex flex-wrap items-center gap-4">
            <p className="text-neutral-400">Quiz complete — results are on the screen.</p>
            <a href="/create" className="text-sm font-medium text-ably hover:underline">
              + New quiz
            </a>
          </div>
        )}
      </div>

      {ended && Object.keys(live.scoreboard).length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-neutral-400 uppercase">
            Final standings
          </h2>
          <Scoreboard scoreboard={live.scoreboard} limit={12} agents={quiz.config.agents} />
          {counterfactual && (
            <CounterfactualPanel
              payload={counterfactual}
              agents={quiz.config.agents}
              className="mt-4"
            />
          )}
          <div className="mt-6">
            <AgentTranscripts agents={quiz.config.agents ?? []} transcripts={agentTranscripts} />
          </div>
        </section>
      )}

      <Lobby members={members} agents={quiz.config.agents} unavailable={unavailable} />
    </main>
  );
}

/** Agent preflight: a tiny gateway call per agent so a quota/auth/model problem
 *  is visible before the quiz, and re-checkable. Only shown when there's news
 *  (checking / issues / unconfigured) — a healthy roster stays out of the way. */
function AgentHealthBanner({ health }: { health: HealthState }) {
  if (health.status === 'ok') return null;
  const broken = health.results.filter((r) => !r.ok);
  const base =
    'mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-sm';

  if (health.status === 'checking') {
    return (
      <div className={`${base} border-neutral-800 bg-neutral-900/40 text-neutral-400`}>
        <span className="animate-pulse">Checking agents…</span>
      </div>
    );
  }
  if (health.status === 'unconfigured') {
    return (
      <div className={`${base} border-amber-800/60 bg-amber-950/30`}>
        <span className="text-amber-400">⚠️ AI gateway not configured</span>
        <span className="text-neutral-400">
          {health.error ?? 'Set AI_GATEWAY_API_KEY in .env.local — agents can’t answer without it.'}
        </span>
        <button
          type="button"
          onClick={health.recheck}
          className="ml-auto text-xs text-neutral-400 underline hover:text-neutral-200"
        >
          re-check
        </button>
      </div>
    );
  }
  // issues
  return (
    <div className={`${base} border-amber-800/60 bg-amber-950/30`}>
      <div className="space-y-0.5">
        <p className="text-amber-400">
          ⚠️ {broken.length} agent{broken.length === 1 ? '' : 's'} won’t answer
        </p>
        <ul className="text-xs text-neutral-400">
          {broken.map((r) => (
            <li key={r.slug}>
              <span className="text-neutral-300">{r.name}</span>: {shortError(r.error)}
            </li>
          ))}
          {health.error && <li>{health.error}</li>}
        </ul>
      </div>
      <button
        type="button"
        onClick={health.recheck}
        className="ml-auto shrink-0 text-xs text-neutral-400 underline hover:text-neutral-200"
      >
        re-check
      </button>
    </div>
  );
}

/** Turn a raw provider error into a one-liner a host can act on. */
function shortError(err?: string): string {
  if (!err) return 'unavailable';
  if (/quota|billing|insufficient/i.test(err)) return 'out of credit / quota';
  if (/rate limit|429/i.test(err)) return 'rate-limited';
  if (/not found|unknown model|does not exist/i.test(err))
    return 'model not available on the gateway';
  if (/auth|401|invalid.*key/i.test(err)) return 'auth error (check the gateway key)';
  return err.length > 80 ? `${err.slice(0, 80)}…` : err;
}

/** MCP grounding auth (§S6). Optional: agents play ungrounded until the host
 *  authenticates, then Anthropic agents can look up Ably knowledge (read-only). */
function McpAuthBanner({ mcp, quizId }: { mcp: McpAuth; quizId: string }) {
  const busy = mcp.status === 'starting' || mcp.status === 'exchanging';
  // Once grounded, celebrate for ~4s then collapse to a compact chip so the
  // control room stays quiet. A reload with a restored token skips the
  // celebration — a per-quiz sessionStorage marker tells "just authenticated"
  // apart from "already authed on load" (§S5.2).
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (mcp.status !== 'authed') {
      setCollapsed(false);
      return;
    }
    const seenKey = `mcp_grounded_seen:${quizId}`;
    if (sessionStorage.getItem(seenKey)) {
      setCollapsed(true);
      return;
    }
    sessionStorage.setItem(seenKey, '1');
    setCollapsed(false);
    const t = setTimeout(() => setCollapsed(true), 4000);
    return () => clearTimeout(t);
  }, [mcp.status, quizId]);

  if (mcp.status === 'authed') {
    if (collapsed) {
      return (
        <div className="mb-6 flex justify-end text-xs">
          <span className="inline-flex items-center gap-1.5">
            <span className="text-emerald-500">✓ grounded</span>
            <span className="text-neutral-600">·</span>
            <button
              type="button"
              onClick={mcp.signOut}
              className="text-neutral-500 underline hover:text-neutral-300"
            >
              sign out
            </button>
          </span>
        </div>
      );
    }
    return (
      <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-emerald-800/60 bg-emerald-950/30 px-4 py-3 text-sm">
        <span className="text-emerald-400">✓ Agents grounded via MCP</span>
        <span className="text-neutral-500">read-only · this session only</span>
        <button
          type="button"
          onClick={mcp.signOut}
          className="ml-auto text-xs text-neutral-500 underline hover:text-neutral-300"
        >
          sign out
        </button>
      </div>
    );
  }
  return (
    <div className="mb-6 flex items-center gap-4 rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm">
      <div className="space-y-0.5">
        <p className="text-neutral-300">
          Optional — agents play fine on their own knowledge without this.
        </p>
        <p className="text-neutral-500">
          Sign in to let them look up your company knowledge over MCP (read-only).
          {mcp.error && <span className="text-red-400"> — {mcp.error}</span>}
        </p>
      </div>
      <button
        type="button"
        onClick={mcp.authenticate}
        disabled={busy}
        className="ml-auto shrink-0 rounded-lg border border-neutral-700 px-4 py-2 font-semibold text-ink hover:border-neutral-500 disabled:opacity-40"
      >
        {busy ? 'Connecting…' : 'Authenticate agents'}
      </button>
    </div>
  );
}

/** Lobby share panel (§S5.2): the QR + join link players scan, plus a link to
 *  open the projector view. Replaces the old standalone "quiz ready" page — the
 *  host lands straight here after creating. The big hero lives on /screen (the
 *  thing you project); this panel stays a compact control-room affordance. */
function HostShare({ quizId }: { quizId: string }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const joinUrl = `${origin}/play?quiz=${quizId}`;
  const screenUrl = `${origin}/screen?quiz=${quizId}`;
  return (
    <section className="mb-8 flex flex-col items-center gap-6 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 sm:flex-row">
      <div className="shrink-0 rounded-xl bg-neutral-950 p-3">
        <JoinQr url={joinUrl} size={132} />
      </div>
      <div className="min-w-0 flex-1 text-center sm:text-left">
        <p className="text-xs tracking-widest text-neutral-500 uppercase">players join at</p>
        <a
          href={joinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1.5 font-mono text-sm break-all text-neutral-300 transition hover:text-ink hover:underline"
        >
          {joinUrl}
          <ExternalLinkIcon className="text-neutral-500" />
        </a>
        <div className="mt-4">
          <a
            href={screenUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-ably px-5 py-2.5 font-semibold text-black transition hover:brightness-110"
          >
            Open shared screen <ExternalLinkIcon />
          </a>
        </div>
        <p className="mt-3 text-xs text-neutral-600">
          Share or project this screen for everyone — players scan to join. You run the quiz from
          here.
        </p>
      </div>
    </section>
  );
}

/** Lobby "Start quiz" (§S5.2). If agents are declared but not grounded with
 *  MCP, the first click swaps in an inline confirm rather than starting —
 *  the host can authenticate or knowingly start ungrounded. A plain quiz (no
 *  agents, or already grounded) starts straight away. */
function StartControls({
  hasAgents,
  groundingAvailable,
  grounded,
  busy,
  disabled,
  onStart,
  onAuthenticate,
}: {
  hasAgents: boolean;
  groundingAvailable: boolean;
  grounded: boolean;
  busy: boolean;
  disabled: boolean;
  onStart: () => void;
  onAuthenticate: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  // Only warn about ungrounded agents when grounding is actually configured —
  // otherwise there's nothing to authenticate and agents always play ungrounded.
  const needsWarning = groundingAvailable && hasAgents && !grounded;

  // If grounding lands while the warning is up (the host clicked "Authenticate
  // agents"), drop it — the plain Start button now starts straight away, so the
  // panel must not keep claiming the agents are ungrounded (§S5.2 review).
  useEffect(() => {
    if (grounded) setConfirming(false);
  }, [grounded]);

  if (confirming) {
    return (
      <div className="w-full space-y-3 rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-sm">
        <p className="text-amber-300">
          Agents aren’t grounded with MCP — they’ll play from their own knowledge.
        </p>
        <div className="flex flex-wrap gap-3">
          <Control onClick={onAuthenticate} busy={busy} primary>
            Authenticate agents
          </Control>
          <Control onClick={onStart} busy={busy}>
            Start anyway →
          </Control>
        </div>
      </div>
    );
  }
  return (
    <Control
      onClick={() => (needsWarning ? setConfirming(true) : onStart())}
      busy={busy}
      disabled={disabled}
      primary
    >
      Start quiz →
    </Control>
  );
}

function Control({
  onClick,
  busy,
  disabled,
  primary,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  disabled?: boolean;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={`rounded-lg px-5 py-3 font-semibold transition disabled:opacity-40 ${
        primary
          ? 'bg-ably text-black'
          : 'border border-neutral-700 text-ink hover:border-neutral-500'
      }`}
    >
      {children}
    </button>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 text-center text-neutral-400">
      {children}
    </main>
  );
}
