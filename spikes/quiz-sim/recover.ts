// S3.5 recovery test — prove that host and player rejoin mid-quiz from history.
//
// Drives a quiz partway with host A (through Q1 reveal, into Q2 asking), then
// simulates host death and exercises the REAL recovery wiring the browser uses:
//   1. Host B rebuilds its Quizmaster purely from channel history
//      (loadControlHistory + loadAnswerHistory + Quizmaster.recover) and must
//      match host A exactly — phase, question index, answer log, standings.
//   2. A fresh player reconstructs the in-flight question from control history
//      (the same reduce useQuizState runs on refresh) — proving a player who
//      missed the live broadcast still sees the current question.
//   3. Host B resumes driving to podium — proving it's a working host, not a
//      read-only snapshot.
//
//   AUTH_BASE_URL=http://localhost:PORT QUIZ_ID=rectest PLAYERS=3 \
//     pnpm --dir spikes/quiz-sim recover

import { fileURLToPath } from 'node:url';
import * as Ably from 'ably';
import { config as loadEnv } from 'dotenv';
import {
  answersChannel,
  mainChannel,
  parseControlMessage,
  Quizmaster,
  type Choice,
  type QuestionDef,
  type QuizConfig,
  type Standing,
} from '@ably-quiz/core';
import {
  AblyBroadcaster,
  AblyLiveStore,
  getMainChannel,
  loadAnswerHistory,
  loadControlHistory,
} from '../../apps/web/lib/quiz-live';
import { connect } from '../../apps/web/lib/ably';

loadEnv({ path: fileURLToPath(new URL('../../.env.local', import.meta.url)) });

const BASE = process.env.AUTH_BASE_URL ?? 'http://127.0.0.1:3000';
// Unique-ish id per run so a re-run isn't polluted by the previous run's
// history (Math.random is avoided in workflows but fine in a standalone spike).
const QUIZ_ID = process.env.QUIZ_ID ?? `rec-${Date.now().toString(36)}`;
const PLAYERS = intEnv('PLAYERS', 3);
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
  streakEnabled: true,
};

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const results: { name: string; ok: boolean; note: string }[] = [];
const check = (name: string, ok: boolean, note = '') => results.push({ name, ok, note });

function whenConnected(client: Ably.Realtime): Promise<void> {
  return new Promise((resolve, reject) => {
    if (client.connection.state === 'connected') return resolve();
    client.connection.once('connected', () => resolve());
    client.connection.once('failed', () =>
      reject(new Error(client.connection.errorReason?.message ?? 'connection failed')),
    );
  });
}

async function token(body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${BASE}/api/ably-auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`auth ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { token: string }).token;
}

/** A synthetic player that answers each question after a short jittered delay. */
async function spawnPlayer(i: number): Promise<Ably.Realtime> {
  const client = new Ably.Realtime({
    authCallback: (_t, cb) => {
      token({ quizId: QUIZ_ID, role: 'player', clientId: `rec-${i}` }).then(
        (t) => cb(null, t),
        (e: unknown) => cb(String(e), null),
      );
    },
  });
  const main = client.channels.get(mainChannel(QUIZ_ID));
  const answers = client.channels.get(answersChannel(QUIZ_ID));
  await main.subscribe('control', (msg) => {
    const m = parseControlMessage(msg.data);
    if (m?.type !== 'question') return;
    // First i players answer correctly; the rest answer wrong — deterministic scores.
    const correctText = QUESTIONS[m.idx]?.options[QUESTIONS[m.idx]!.correctIndex];
    const correctLetter = LETTERS[m.options.indexOf(correctText ?? '')] ?? 'A';
    const choice = i < PLAYERS - 1 ? correctLetter : LETTERS[(m.idx + 1) % m.options.length]!;
    setTimeout(() => void answers.publish('answer', { idx: m.idx, choice }), 150 + i * 120);
  });
  await main.presence.enter({ name: `Rec ${i + 1}` });
  return client;
}

/** Build a fresh Quizmaster wired to a host client's Ably adapters. */
function makeHost(client: Ably.Realtime): Quizmaster {
  return new Quizmaster({
    quizId: QUIZ_ID,
    questions: QUESTIONS,
    config: CONFIG,
    broadcaster: new AblyBroadcaster(client, QUIZ_ID),
    store: new AblyLiveStore(client, QUIZ_ID),
  });
}

/** Subscribe a host's answer fan-in and presence → names, like useHostQuiz. */
async function wireHost(client: Ably.Realtime, qm: Quizmaster): Promise<void> {
  const main = getMainChannel(client, QUIZ_ID, { write: true });
  await main.presence.subscribe((m) => {
    if (m.clientId)
      qm.setDisplayName(m.clientId, (m.data as { name?: string })?.name ?? m.clientId);
  });
  (await main.presence.get()).forEach((m) => {
    if (m.clientId)
      qm.setDisplayName(m.clientId, (m.data as { name?: string })?.name ?? m.clientId);
  });
  const answers = client.channels.get(answersChannel(QUIZ_ID));
  await answers.subscribe((msg) => {
    qm.ingest({
      clientId: msg.clientId ?? '',
      data: msg.data,
      serverTs: msg.timestamp ?? Date.now(),
    });
  });
}

const standingsKey = (s: Standing[]): string =>
  s
    .map((e) => `${e.clientId}:${e.score}`)
    .sort()
    .join('|');

async function main(): Promise<void> {
  console.log(`recover: quiz=${QUIZ_ID} players=${PLAYERS} base=${BASE}`);
  const players = await Promise.all(Array.from({ length: PLAYERS }, (_u, i) => spawnPlayer(i)));
  console.log(`recover: ${players.length} players present`);

  // --- Host A drives through Q1 reveal, into Q2 asking, then "dies". ---------
  const { client: clientA } = await connect({ quizId: QUIZ_ID, role: 'host' }, BASE);
  await whenConnected(clientA);
  const qmA = makeHost(clientA);
  await wireHost(clientA, qmA);
  qmA.init();
  await delay(1200); // let presence settle so display names are known

  await qmA.askNext(); // Q1
  await delay(1500);
  await qmA.lock();
  await delay(400);
  await qmA.reveal();
  await delay(600);
  await qmA.askNext(); // Q2 — leave it OPEN (asking)
  await delay(2000); // all Q2 answers land + are ingested

  const stateA = qmA.getState();
  const standingsA = qmA.getStandings();
  const logLenA = qmA.getAnswerLog().length;
  console.log(
    `recover: host A snapshot — phase=${stateA.phase} idx=${stateA.questionIdx} answers=${logLenA}`,
  );
  clientA.close(); // simulate host tab closing / function death

  // --- Host B rebuilds from history alone (the browser refresh path). --------
  const { client: clientB } = await connect({ quizId: QUIZ_ID, role: 'host' }, BASE);
  await whenConnected(clientB);
  const qmB = makeHost(clientB);
  await wireHost(clientB, qmB);
  const mainB = getMainChannel(clientB, QUIZ_ID, { write: true });
  const answersB = clientB.channels.get(answersChannel(QUIZ_ID));
  const [controlHistory, answerHistory] = await Promise.all([
    loadControlHistory(mainB),
    loadAnswerHistory(answersB),
  ]);
  qmB.recover(controlHistory, answerHistory);

  const stateB = qmB.getState();
  const standingsB = qmB.getStandings();
  const logLenB = qmB.getAnswerLog().length;
  console.log(
    `recover: host B recovered — phase=${stateB.phase} idx=${stateB.questionIdx} answers=${logLenB}`,
  );

  check(
    'host recovery: phase + question index match',
    stateB.phase === stateA.phase && stateB.questionIdx === stateA.questionIdx,
    `A=${stateA.phase}/${stateA.questionIdx} B=${stateB.phase}/${stateB.questionIdx}`,
  );
  check(
    'host recovery: answer log length matches',
    logLenB === logLenA,
    `A=${logLenA} B=${logLenB}`,
  );
  check(
    'host recovery: standings (scores) match exactly',
    standingsKey(standingsA) === standingsKey(standingsB),
    standingsKey(standingsB),
  );

  // --- Player recovery: a PLAYER (not host) reconstructs the in-flight question
  // from history — exercising the player `history` capability (§B2.5) and the
  // exact reduce useQuizState runs when a player joins mid-question. Reading via
  // a player token proves the capability, not just the logic.
  const playerMain = players[0]!.channels.get(mainChannel(QUIZ_ID));
  const playerControlHistory = await loadControlHistory(playerMain);
  let recovered: { idx: number; prompt: string; options: string[] } | null = null;
  for (const { msg } of playerControlHistory) {
    if (msg.type === 'question') {
      recovered = { idx: msg.idx, prompt: msg.prompt, options: msg.options };
    }
  }
  const q2 = QUESTIONS[stateA.questionIdx]!;
  const sameOptions =
    recovered != null &&
    recovered.options.length === q2.options.length &&
    [...recovered.options].sort().join('|') === [...q2.options].sort().join('|');
  check(
    'player recovery: PLAYER token reads main history + reconstructs in-flight question',
    recovered?.idx === stateA.questionIdx && recovered?.prompt === q2.prompt && sameOptions,
    recovered ? `Q${recovered.idx + 1}: ${recovered.prompt}` : 'none',
  );

  // --- Host B resumes driving to podium (proves it's a live host, not a dump).
  await qmB.lock();
  await delay(400);
  await qmB.reveal();
  await delay(400);
  await qmB.podium();
  check('host recovery: recovered host can resume to podium', qmB.getState().phase === 'podium');

  // Let the final coalesced LiveObjects writes flush BEFORE tearing down, so
  // teardown doesn't race the store (which would just warn, but keeps output clean).
  await delay(800);
  players.forEach((p) => p.close());
  clientB.close();

  let allOk = true;
  console.log('\nS3.5 recovery — host + player rejoin mid-quiz:');
  for (const { name, ok, note } of results) {
    console.log(`  ${ok ? '✓' : '✗'} ${name}${note ? ` — ${note}` : ''}`);
    if (!ok) allOk = false;
  }
  console.log(allOk ? '\nRECOVERY PASS' : '\nRECOVERY FAIL');
  await delay(300);
  process.exit(allOk ? 0 : 1);
}

function intEnv(name: string, dflt: number): number {
  const v = process.env[name];
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : dflt;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
