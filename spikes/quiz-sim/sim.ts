// Drive a real quiz through Ably. Host = the core Quizmaster wired to the SAME
// web adapters the browser uses (AblyBroadcaster + AblyLiveStore); players =
// synthetic clients that answer over the fan-in channel. Verifies the S3.3 loop
// end-to-end and scales up to be the S3.6 load harness.
//
//   AUTH_BASE_URL=http://127.0.0.1:PORT QUIZ_ID=sim PLAYERS=5 \
//     pnpm --dir spikes/quiz-sim sim

import { fileURLToPath } from 'node:url';
import * as Ably from 'ably';
import { LiveObjects } from 'ably/liveobjects';
import { config as loadEnv } from 'dotenv';
import {
  answersChannel,
  mainChannel,
  parseControlMessage,
  Quizmaster,
  type Choice,
  type QuestionDef,
  type QuizConfig,
} from '@ably-quiz/core';
import { AblyBroadcaster, AblyLiveStore, getMainChannel } from '../../apps/web/lib/quiz-live';

loadEnv({ path: fileURLToPath(new URL('../../.env.local', import.meta.url)) });

const BASE = process.env.AUTH_BASE_URL ?? 'http://127.0.0.1:3000';
const QUIZ_ID = process.env.QUIZ_ID ?? 'sim';
const PLAYERS = intEnv('PLAYERS', 5);
const QUESTION_MS = intEnv('QUESTION_MS', 8000);
const REVEAL_MS = intEnv('REVEAL_MS', 3000);
const CORRECT_RATE = floatEnv('CORRECT_RATE', 0.7);
const LETTERS: Choice[] = ['A', 'B', 'C', 'D'];

const QUESTIONS: QuestionDef[] = [
  {
    prompt: 'Chemical symbol for gold?',
    options: ['Au', 'Ag', 'Gd', 'Go'],
    correctIndex: 0,
    limitMs: 20_000,
  },
  {
    prompt: 'Which Ably product is for multiplayer collaboration?',
    options: ['Spaces', 'Pub/Sub', 'Chat', 'LiveSync'],
    correctIndex: 0,
    limitMs: 20_000,
  },
  {
    prompt: 'What does AIT stand for at Ably?',
    options: ['AI Transport', 'Async Integration Tier', 'Ably Internal Tooling', 'Adaptive Ingest'],
    correctIndex: 0,
    limitMs: 20_000,
  },
];
const CONFIG: QuizConfig = {
  scoringAlgoId: 'classic',
  questionCount: QUESTIONS.length,
  defaultLimitMs: 20_000,
  streakEnabled: false,
};

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function token(body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${BASE}/api/ably-auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`auth ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { token: string; clientId: string }).token;
}

function clientFor(body: Record<string, unknown>, withObjects: boolean): Ably.Realtime {
  return new Ably.Realtime({
    ...(withObjects ? { plugins: { LiveObjects } } : {}),
    authCallback: (_t, cb) => {
      token(body).then(
        (t) => cb(null, t),
        (e: unknown) => cb(String(e), null),
      );
    },
  });
}

async function main(): Promise<void> {
  console.log(`sim: quiz=${QUIZ_ID} players=${PLAYERS} base=${BASE}`);

  // --- Players: subscribe control, answer each question after a jittered delay.
  const players = await Promise.all(
    Array.from({ length: PLAYERS }, async (_unused, i) => {
      const client = clientFor({ quizId: QUIZ_ID, role: 'player', clientId: `sim-${i}` }, false);
      const main = client.channels.get(mainChannel(QUIZ_ID));
      const answers = client.channels.get(answersChannel(QUIZ_ID));
      await main.subscribe('control', (msg) => {
        const m = parseControlMessage(msg.data);
        if (m?.type !== 'question') return;
        // Deterministic-ish correctness by player index, jittered answer time.
        const correct = i / PLAYERS < CORRECT_RATE;
        const correctLetter =
          LETTERS[m.options.indexOf(QUESTIONS[m.idx]!.options[QUESTIONS[m.idx]!.correctIndex]!)] ??
          'A';
        const choice = correct ? correctLetter : LETTERS[(m.idx + i) % m.options.length]!;
        const wait = 200 + ((i * 137) % Math.max(1, QUESTION_MS - 1500));
        setTimeout(() => void answers.publish('answer', { idx: m.idx, choice }), wait);
      });
      // Enter presence so the lobby shows them.
      await main.presence.enter({ name: `Sim ${i + 1}` });
      return client;
    }),
  );
  console.log(`sim: ${players.length} players connected + present`);

  // --- Host: the real core Quizmaster wired to Ably via the web adapters.
  const hostClient = clientFor({ quizId: QUIZ_ID, role: 'host' }, true);
  const qm = new Quizmaster({
    quizId: QUIZ_ID,
    questions: QUESTIONS,
    config: CONFIG,
    broadcaster: new AblyBroadcaster(hostClient, QUIZ_ID),
    store: new AblyLiveStore(hostClient, QUIZ_ID),
  });
  const hostMain = getMainChannel(hostClient, QUIZ_ID, { write: true });
  await hostMain.presence.subscribe((m) => {
    if (m.clientId)
      qm.setDisplayName(m.clientId, (m.data as { name?: string })?.name ?? m.clientId);
  });
  (await hostMain.presence.get()).forEach((m) => {
    if (m.clientId)
      qm.setDisplayName(m.clientId, (m.data as { name?: string })?.name ?? m.clientId);
  });
  const hostAnswers = hostClient.channels.get(answersChannel(QUIZ_ID));
  await hostAnswers.subscribe((msg) => {
    qm.ingest({
      clientId: msg.clientId ?? '',
      data: msg.data,
      serverTs: msg.timestamp ?? Date.now(),
    });
  });
  qm.init();
  await delay(1500); // let presence settle so names are known

  for (let i = 0; i < QUESTIONS.length; i++) {
    await qm.askNext();
    console.log(`sim: Q${i + 1} asking (${QUESTION_MS}ms window)`);
    await delay(QUESTION_MS);
    await qm.lock();
    await delay(600);
    await qm.reveal();
    console.log(`sim: Q${i + 1} revealed`);
    await delay(REVEAL_MS);
  }
  await qm.podium();

  const standings = qm.getStandings();
  const answered = qm.getAnswerLog().length;
  console.log(
    `\nsim done. answers=${answered} players=${PLAYERS}x${QUESTIONS.length}=${PLAYERS * QUESTIONS.length}`,
  );
  console.log(
    'top:',
    standings
      .slice(0, 5)
      .map((s) => `${s.clientId}:${s.score}`)
      .join('  '),
  );

  await delay(1000);
  players.forEach((p) => p.close());
  hostClient.close();
  process.exit(0);
}

function intEnv(name: string, dflt: number): number {
  const v = process.env[name];
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : dflt;
}
function floatEnv(name: string, dflt: number): number {
  const v = process.env[name];
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : dflt;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
