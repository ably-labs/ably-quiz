'use client';

import {
  type AgentRosterEntry,
  DEFAULT_ALGO_ID,
  LIMIT_DEFAULT_S,
  LIMIT_MAX_S,
  LIMIT_MIN_S,
  listAlgos,
  parseQuestions,
  type QuestionDef,
  type QuizConfig,
} from '@ably-quiz/core';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import {
  emptyRow,
  isRowEmpty,
  QuestionGrid,
  rowCells,
  type GridRow,
} from '@/components/QuestionGrid';
import { saveQuiz, type StoredQuiz } from '@/lib/quiz-storage';
import { generateQuizId } from '@/lib/slug';

const START_ROWS = 3;

// Dev-only convenience: a handful of ready-made questions so manual testing on
// localhost doesn't require typing a quiz every time (see the "load samples" link).
const SAMPLE_ROWS: GridRow[] = [
  {
    question: 'What is the chemical symbol for gold?',
    correct: 'Au',
    wrong1: 'Ag',
    wrong2: 'Gd',
    wrong3: 'Go',
    limit: '',
    category: 'Science',
  },
  {
    question: 'How many continents are there on Earth?',
    correct: 'Seven',
    wrong1: 'Five',
    wrong2: 'Six',
    wrong3: 'Eight',
    limit: '',
    category: 'Geography',
  },
  {
    question: 'Which Ably product is for multiplayer collaboration?',
    correct: 'Spaces',
    wrong1: 'Pub/Sub',
    wrong2: 'Chat',
    wrong3: 'LiveSync',
    limit: '',
    category: 'Ably',
  },
  {
    question: 'What does “AIT” stand for at Ably?',
    correct: 'AI Transport',
    wrong1: 'Ably Internal Tooling',
    wrong2: 'Async Integration Tier',
    wrong3: 'Adaptive Ingest',
    limit: '',
    category: 'Ably',
  },
  {
    question: 'Which planet is the largest in our solar system?',
    correct: 'Jupiter',
    wrong1: 'Saturn',
    wrong2: 'Neptune',
    wrong3: 'Earth',
    limit: '',
    category: 'Science',
  },
];

/** An agent available to play, as returned by GET /api/agents. */
type AvailableAgent = AgentRosterEntry & { provider: string };

/** True on localhost / .local / .test hosts — gates dev-only helpers. */
function isLocalHost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '[::1]' ||
    h.endsWith('.local') ||
    h.endsWith('.test')
  );
}

/** Validate each non-empty row on its own so errors map to visible grid rows.
 *  A blank Time cell falls back to the quiz-wide default. */
function validate(
  rows: GridRow[],
  defaultLimitS: number,
): {
  questions: QuestionDef[];
  errors: string[];
  badRows: Set<number>;
} {
  const questions: QuestionDef[] = [];
  const errors: string[] = [];
  const badRows = new Set<number>();
  rows.forEach((row, i) => {
    if (isRowEmpty(row)) return;
    const cells = rowCells(row);
    const res = parseQuestions(cells.join('\t'));
    if (res.questions.length === 1 && res.errors.length === 0) {
      const question = res.questions[0]!;
      if (cells[5]!.trim() === '') question.limitMs = defaultLimitS * 1000; // blank → quiz default
      questions.push(question);
    } else {
      badRows.add(i);
      errors.push(`Row ${i + 1}: ${res.errors[0]?.replace(/^Row \d+:\s*/, '') ?? 'invalid'}`);
    }
  });
  return { questions, errors, badRows };
}

export default function CreatePage() {
  const [rows, setRows] = useState<GridRow[]>(() => Array.from({ length: START_ROWS }, emptyRow));
  const [defaultLimitS, setDefaultLimitS] = useState(LIMIT_DEFAULT_S);
  const [algoId, setAlgoId] = useState(DEFAULT_ALGO_ID);
  const [streakEnabled, setStreakEnabled] = useState(false);
  const [autoReveal, setAutoReveal] = useState(true);
  const [created, setCreated] = useState<{ quiz: StoredQuiz; origin: string } | null>(null);
  const [devLike, setDevLike] = useState(false);
  useEffect(() => setDevLike(isLocalHost()), []);

  // The agent roster (§S4.4): fetch who's available, default all checked, let the
  // host uncheck any. The chosen set is stored in config as the declarative roster.
  const [available, setAvailable] = useState<AvailableAgent[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let alive = true;
    void fetch('/api/agents')
      .then((r) => (r.ok ? r.json() : { agents: [] }))
      .then((d: { agents?: AvailableAgent[] }) => {
        if (alive) setAvailable(d.agents ?? []);
      })
      .catch(() => {
        /* no agents endpoint / none available — humans-only quiz */
      });
    return () => {
      alive = false;
    };
  }, []);

  const { questions, errors, badRows } = useMemo(
    () => validate(rows, defaultLimitS),
    [rows, defaultLimitS],
  );
  const algos = useMemo(() => listAlgos(), []);
  const canCreate = questions.length > 0;

  function handleCreate() {
    if (!canCreate) return;
    const quizId = generateQuizId();
    const agents: AgentRosterEntry[] = available
      .filter((a) => !excluded.has(a.slug))
      .map(({ slug, name, emoji, owner, model }) => ({ slug, name, emoji, owner, model }));
    const config: QuizConfig = {
      scoringAlgoId: algoId,
      questionCount: questions.length,
      defaultLimitMs: defaultLimitS * 1000,
      streakEnabled,
      autoReveal,
      ...(agents.length > 0 ? { agents } : {}),
    };
    const quiz: StoredQuiz = { quizId, createdAt: Date.now(), questions, config };
    saveQuiz(quiz);
    setCreated({ quiz, origin: window.location.origin });
  }

  if (created) return <CreatedView quiz={created.quiz} origin={created.origin} />;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-8">
        <p className="text-xs font-medium tracking-[0.3em] text-ably uppercase">the Ably Quiz</p>
        <h1 className="text-4xl font-extrabold tracking-tight">Create a quiz</h1>
        <p className="mt-2 text-neutral-400">
          Type your questions, or copy a block straight out of a spreadsheet and paste it into the
          grid.
        </p>
      </header>

      <section className="mb-8">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <h2 className="text-sm font-semibold text-neutral-300">Questions</h2>
            {devLike && (
              <button
                type="button"
                onClick={() => setRows([...SAMPLE_ROWS.map((r) => ({ ...r })), emptyRow()])}
                className="text-xs text-ably hover:underline"
                title="Dev only — fill the grid with sample questions"
              >
                load samples
              </button>
            )}
          </div>
          <span className="text-sm text-neutral-500">
            {questions.length} valid{errors.length > 0 ? ` · ${errors.length} to fix` : ''}
          </span>
        </div>
        <QuestionGrid rows={rows} onChange={setRows} badRows={badRows} />
        {errors.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-300">
            {errors.map((e, i) => (
              <li key={i}>⚠️ {e}</li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-neutral-400">
          <label htmlFor="defaultLimit">Default time per question</label>
          <input
            id="defaultLimit"
            type="number"
            min={LIMIT_MIN_S}
            max={LIMIT_MAX_S}
            value={defaultLimitS}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              setDefaultLimitS(
                Number.isFinite(n)
                  ? Math.min(LIMIT_MAX_S, Math.max(LIMIT_MIN_S, n))
                  : LIMIT_DEFAULT_S,
              );
            }}
            className="w-16 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-center text-ink outline-none focus:border-ably"
          />
          <span>seconds</span>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-neutral-500">
          <span className="text-neutral-300">Time (s)</span> and{' '}
          <span className="text-neutral-300">Category</span> are optional. Leave <b>Time</b> blank
          to use the default above (or set {LIMIT_MIN_S}–{LIMIT_MAX_S}s on a row). <b>Category</b>{' '}
          is a short label shown above the question on the big screen — e.g. “Science” — purely for
          flavour.
        </p>
      </section>

      <fieldset className="mb-8">
        <legend className="text-sm font-semibold text-neutral-300">Scoring</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {algos.map((a) => (
            <label
              key={a.id}
              className={`cursor-pointer rounded-lg border p-3 text-sm ${
                algoId === a.id
                  ? 'border-ably bg-ably/10'
                  : 'border-neutral-800 hover:border-neutral-700'
              }`}
            >
              <input
                type="radio"
                name="algo"
                value={a.id}
                checked={algoId === a.id}
                onChange={() => setAlgoId(a.id)}
                className="sr-only"
              />
              <span className="block font-medium">{a.label}</span>
              <span className="mt-1 block text-xs text-neutral-400">{a.blurb}</span>
            </label>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={streakEnabled}
            onChange={(e) => setStreakEnabled(e.target.checked)}
          />
          Streak bonus (×1.1 up to ×1.5 for consecutive correct answers)
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={autoReveal}
            onChange={(e) => setAutoReveal(e.target.checked)}
          />
          Auto-reveal the answer once everyone&apos;s answered or time&apos;s up
        </label>
        <p className="mt-1 max-w-2xl text-xs text-neutral-500">
          On (default), a question ends the moment it&apos;s decided — no waiting. Turn off to hold
          on the locked screen and reveal manually for suspense.
        </p>
      </fieldset>

      {available.length > 0 && (
        <fieldset className="mb-8">
          <legend className="text-sm font-semibold text-neutral-300">
            Agents{' '}
            <span className="font-normal text-neutral-500">
              — {available.length - excluded.size} of {available.length} playing
            </span>
          </legend>
          <p className="mt-1 mb-3 max-w-2xl text-xs text-neutral-500">
            AI contestants join the quiz alongside humans. All are in by default — uncheck any you
            want to sit out.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {available.map((a) => {
              const on = !excluded.has(a.slug);
              return (
                <label
                  key={a.slug}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition ${
                    on
                      ? 'border-neutral-700 bg-neutral-900/40'
                      : 'border-neutral-800 bg-transparent opacity-45'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) =>
                      setExcluded((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.delete(a.slug);
                        else next.add(a.slug);
                        return next;
                      })
                    }
                  />
                  <span className="text-lg">{a.emoji}</span>
                  <span className="flex-1">
                    <span className="block font-medium">{a.name}</span>
                    <span className="block text-xs text-neutral-500">
                      {a.model} · built by {a.owner}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      <button
        type="button"
        onClick={handleCreate}
        disabled={!canCreate}
        className="rounded-lg bg-ably px-6 py-3 font-semibold text-black transition disabled:cursor-not-allowed disabled:opacity-40"
      >
        Create quiz
      </button>
    </main>
  );
}

/** Standard "opens in a new tab" glyph — a box with an arrow leaving the top-right. */
function ExternalLinkIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block h-[1em] w-[1em] shrink-0 ${className}`}
      aria-hidden
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  );
}

function CreatedView({ quiz, origin }: { quiz: StoredQuiz; origin: string }) {
  const joinUrl = `${origin}/play?quiz=${quiz.quizId}`;
  const screenUrl = `${origin}/screen?quiz=${quiz.quizId}`;
  const hostUrl = `${origin}/host?quiz=${quiz.quizId}`;
  const [qr, setQr] = useState('');

  useEffect(() => {
    void QRCode.toString(joinUrl, {
      type: 'svg',
      margin: 1,
      color: { dark: '#ededed', light: '#00000000' },
    }).then(setQr);
  }, [joinUrl]);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-center">
      <p className="text-xs font-medium tracking-[0.3em] text-ably uppercase">quiz ready</p>
      <h1 className="mt-1 text-4xl font-extrabold tracking-tight">{quiz.quizId}</h1>
      <p className="mt-2 text-neutral-400">
        {quiz.questions.length} questions · scoring: {quiz.config.scoringAlgoId}
        {quiz.config.streakEnabled ? ' + streak' : ''}
      </p>

      <div
        className="mx-auto mt-8 w-56"
        aria-label="Join QR code"
        dangerouslySetInnerHTML={{ __html: qr }}
      />
      <a
        href={joinUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex items-center gap-1.5 font-mono text-sm text-neutral-300 transition hover:text-ink hover:underline"
      >
        {joinUrl}
        <ExternalLinkIcon className="text-neutral-500" />
      </a>

      <div className="mt-10 flex flex-wrap justify-center gap-3">
        <a
          href={screenUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-ably px-5 py-3 font-semibold text-black"
        >
          Open screen <ExternalLinkIcon />
        </a>
        <a
          href={hostUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 px-5 py-3 font-semibold text-ink hover:border-neutral-500"
        >
          Open host controls <ExternalLinkIcon />
        </a>
      </div>
      <p className="mt-6 text-xs text-neutral-600">
        Open the screen on the projector and host controls on your laptop (same machine).
      </p>
    </main>
  );
}
