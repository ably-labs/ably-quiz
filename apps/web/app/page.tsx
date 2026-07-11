'use client';

import { DEFAULT_ALGO_ID, listAlgos, parseQuestions, type QuizConfig } from '@ably-quiz/core';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { saveQuiz, type StoredQuiz } from '@/lib/quiz-storage';
import { generateQuizId } from '@/lib/slug';

const TEMPLATE_HINT = 'question\tcorrect\twrong1\twrong2\twrong3\ttime_limit_s\tcategory';

export default function CreatePage() {
  const [text, setText] = useState('');
  const [algoId, setAlgoId] = useState(DEFAULT_ALGO_ID);
  const [streakEnabled, setStreakEnabled] = useState(false);
  const [hostKey, setHostKey] = useState('');
  const [created, setCreated] = useState<{ quiz: StoredQuiz; origin: string } | null>(null);

  const parsed = useMemo(() => parseQuestions(text), [text]);
  const algos = useMemo(() => listAlgos(), []);
  const canCreate = parsed.questions.length > 0 && hostKey.trim().length > 0;

  function handleCreate() {
    if (!canCreate) return;
    const quizId = generateQuizId();
    const config: QuizConfig = {
      scoringAlgoId: algoId,
      questionCount: parsed.questions.length,
      defaultLimitMs: 20_000,
      streakEnabled,
    };
    const quiz: StoredQuiz = {
      quizId,
      createdAt: Date.now(),
      questions: parsed.questions,
      config,
      hostKey: hostKey.trim(),
    };
    saveQuiz(quiz);
    setCreated({ quiz, origin: window.location.origin });
  }

  if (created) return <CreatedView quiz={created.quiz} origin={created.origin} />;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <p className="text-xs font-medium tracking-[0.3em] text-ably uppercase">the Ably Quiz</p>
        <h1 className="text-4xl font-extrabold tracking-tight">Create a quiz</h1>
        <p className="mt-2 text-neutral-400">
          Paste rows from the spreadsheet template. Columns:{' '}
          <code className="rounded bg-neutral-800 px-1 py-0.5 text-xs">{TEMPLATE_HINT}</code>
        </p>
      </header>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder="Paste your questions here (TSV from Google Sheets, or CSV)…"
        className="w-full resize-y rounded-lg border border-neutral-800 bg-neutral-900 p-4 font-mono text-sm text-ink outline-none focus:border-ably"
      />

      {text.trim() && (
        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-300">
              Preview — {parsed.questions.length} question{parsed.questions.length === 1 ? '' : 's'}
            </h2>
          </div>
          {parsed.errors.length > 0 && (
            <ul className="mb-4 space-y-1 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-300">
              {parsed.errors.map((e, i) => (
                <li key={i}>⚠️ {e}</li>
              ))}
            </ul>
          )}
          {parsed.questions.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-neutral-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-neutral-900 text-neutral-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Question</th>
                    <th className="px-3 py-2 font-medium">Options (✓ correct)</th>
                    <th className="px-3 py-2 font-medium">Limit</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.questions.map((q, i) => (
                    <tr key={i} className="border-t border-neutral-800/60 align-top">
                      <td className="px-3 py-2 text-neutral-500">{i + 1}</td>
                      <td className="px-3 py-2">{q.prompt}</td>
                      <td className="px-3 py-2">
                        {q.options.map((o, oi) => (
                          <span
                            key={oi}
                            className={
                              oi === q.correctIndex
                                ? 'mr-2 rounded bg-ably/15 px-1.5 py-0.5 text-ably'
                                : 'mr-2 text-neutral-400'
                            }
                          >
                            {oi === q.correctIndex ? '✓ ' : ''}
                            {o}
                          </span>
                        ))}
                      </td>
                      <td className="px-3 py-2 text-neutral-500">{q.limitMs / 1000}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <fieldset className="mt-8">
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
      </fieldset>

      <div className="mt-8">
        <label className="block text-sm font-semibold text-neutral-300" htmlFor="hostKey">
          Host key
        </label>
        <p className="mb-2 text-xs text-neutral-500">
          The quiz-creation secret. Stays on this machine — never put in a shared link.
        </p>
        <input
          id="hostKey"
          type="password"
          value={hostKey}
          onChange={(e) => setHostKey(e.target.value)}
          placeholder="HOST_KEY"
          className="w-full max-w-sm rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm outline-none focus:border-ably"
        />
      </div>

      <button
        type="button"
        onClick={handleCreate}
        disabled={!canCreate}
        className="mt-8 rounded-lg bg-ably px-6 py-3 font-semibold text-black transition disabled:cursor-not-allowed disabled:opacity-40"
      >
        Create quiz
      </button>
    </main>
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
      <p className="mt-3 font-mono text-sm text-neutral-300">{joinUrl}</p>

      <div className="mt-10 flex flex-wrap justify-center gap-3">
        <a
          href={screenUrl}
          target="_blank"
          rel="noopener"
          className="rounded-lg bg-ably px-5 py-3 font-semibold text-black"
        >
          Open screen →
        </a>
        <a
          href={hostUrl}
          target="_blank"
          rel="noopener"
          className="rounded-lg border border-neutral-700 px-5 py-3 font-semibold text-ink hover:border-neutral-500"
        >
          Open host controls →
        </a>
      </div>
      <p className="mt-6 text-xs text-neutral-600">
        Open the screen on the projector and host controls on your laptop (same machine).
      </p>
    </main>
  );
}
