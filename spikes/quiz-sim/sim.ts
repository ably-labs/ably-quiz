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
import { connect } from '../../apps/web/lib/ably';

loadEnv({ path: fileURLToPath(new URL('../../.env.local', import.meta.url)) });

const BASE = process.env.AUTH_BASE_URL ?? 'http://127.0.0.1:3000';
const QUIZ_ID = process.env.QUIZ_ID ?? 'sim';
const PLAYERS = intEnv('PLAYERS', 5);
const QUESTION_MS = intEnv('QUESTION_MS', 8000);
const REVEAL_MS = intEnv('REVEAL_MS', 3000);
const CORRECT_RATE = floatEnv('CORRECT_RATE', 0.7);
// Load-test knobs (S3.6). Defaults keep the S3.3 behaviour unchanged.
const BURST_MS = intEnv('BURST_MS', 0); // >0: every player answers within this window
const RAMP_CHUNK = intEnv('RAMP_CHUNK', 0); // >0: open connections in chunks of this size
const RAMP_DELAY_MS = intEnv('RAMP_DELAY_MS', 150); // pause between ramp chunks
// Distinct per-process id prefix so multiple player processes don't collide on
// clientId (the quizmaster dedupes first-answer-wins by clientId#idx).
const CLIENT_PREFIX = process.env.CLIENT_PREFIX ?? 'sim';
const LETTERS: Choice[] = ['A', 'B', 'C', 'D'];

// Aggregate answer-publish failures across all players (rate limits show as 42911).
const pubErrors = { total: 0, byCode: {} as Record<string, number> };

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

function whenConnected(client: Ably.Realtime): Promise<void> {
  return new Promise((resolve, reject) => {
    if (client.connection.state === 'connected') return resolve();
    client.connection.once('connected', () => resolve());
    client.connection.once('failed', () =>
      reject(
        new Error(`connection failed: ${client.connection.errorReason?.message ?? 'unknown'}`),
      ),
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

  // One synthetic player: subscribe control, answer each question, enter presence.
  // Resilient — a connection/presence failure (e.g. the 250 presence-member cap)
  // returns null rather than crashing the run, so we report how many connected.
  const makePlayer = async (i: number): Promise<Ably.Realtime | null> => {
    try {
      const client = clientFor(
        { quizId: QUIZ_ID, role: 'player', clientId: `${CLIENT_PREFIX}-${i}` },
        false,
      );
      const main = client.channels.get(mainChannel(QUIZ_ID));
      const answers = client.channels.get(answersChannel(QUIZ_ID));
      await main.subscribe('control', (msg) => {
        const m = parseControlMessage(msg.data);
        if (m?.type !== 'question') return;
        // Deterministic-ish correctness by player index, jittered answer time.
        // Guarded so players also work against an external host's question set.
        const def = QUESTIONS[m.idx];
        const correctLetter = def
          ? (LETTERS[m.options.indexOf(def.options[def.correctIndex]!)] ?? 'A')
          : 'A';
        const wantCorrect = i / PLAYERS < CORRECT_RATE;
        const choice = wantCorrect ? correctLetter : LETTERS[(m.idx + i) % m.options.length]!;
        // BURST_MS>0 (load test): spread every player evenly across the burst window
        // so ~PLAYERS answers hit the fan-in in BURST_MS. Else the S3.3 jitter.
        const wait =
          BURST_MS > 0
            ? Math.floor((i / PLAYERS) * BURST_MS)
            : 200 + ((i * 137) % Math.max(1, QUESTION_MS - 1500));
        setTimeout(() => {
          answers.publish('answer', { idx: m.idx, choice }).catch((e: unknown) => {
            const code = String((e as { code?: number })?.code ?? 'unknown');
            pubErrors.total += 1;
            pubErrors.byCode[code] = (pubErrors.byCode[code] ?? 0) + 1;
          });
        }, wait);
      });
      // NO_PRESENCE=1 isolates whether presence traffic on the main channel is
      // what degrades control/answer delivery at scale (diagnostic).
      if (process.env.NO_PRESENCE !== '1') await main.presence.enter({ name: `Sim ${i + 1}` });
      return client;
    } catch {
      return null;
    }
  };

  // --- Players. Open all at once, or ramp in chunks (RAMP_CHUNK) to stay under
  // the connection-per-second limit at high player counts.
  const players: Ably.Realtime[] = [];
  if (RAMP_CHUNK > 0) {
    for (let start = 0; start < PLAYERS; start += RAMP_CHUNK) {
      const size = Math.min(RAMP_CHUNK, PLAYERS - start);
      const chunk = await Promise.all(
        Array.from({ length: size }, (_u, k) => makePlayer(start + k)),
      );
      players.push(...chunk.filter((c): c is Ably.Realtime => c !== null));
      if (start + RAMP_CHUNK < PLAYERS) await delay(RAMP_DELAY_MS);
    }
  } else {
    const all = await Promise.all(Array.from({ length: PLAYERS }, (_u, i) => makePlayer(i)));
    players.push(...all.filter((c): c is Ably.Realtime => c !== null));
  }
  console.log(`sim: ${players.length}/${PLAYERS} players connected + present`);

  // Players-only: an external (e.g. browser) host drives the quiz; just answer.
  if (process.env.PLAYERS_ONLY === '1') {
    console.log(`sim: players-only — answering an external host's questions for 120s`);
    await delay(120_000);
    players.forEach((p) => p.close());
    process.exit(0);
  }

  // --- Host: the real core Quizmaster, connected via the SAME connect() the
  // browser /host uses — so this sim regression-tests the clientId handshake.
  const { client: hostClient } = await connect({ quizId: QUIZ_ID, role: 'host' }, BASE);
  await whenConnected(hostClient);
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
    const window = BURST_MS > 0 ? `${BURST_MS}ms burst` : `${QUESTION_MS}ms window`;
    console.log(`sim: Q${i + 1} asking (${window})`);
    await delay(QUESTION_MS);
    await qm.lock();
    const received = qm.getAnswerLog().filter((e) => e.idx === i).length;
    console.log(`sim: Q${i + 1} locked — ${received}/${players.length} answers in`);
    await delay(600);
    await qm.reveal();
    await delay(REVEAL_MS);
  }
  await qm.podium();

  // --- Result summary. For the S3.6 gate: zero dropped answers means every
  // connected player's answer for every question reached the quizmaster.
  const standings = qm.getStandings();
  const answered = qm.getAnswerLog().length;
  const expected = players.length * QUESTIONS.length;
  const dropped = expected - answered;
  const dropPct = expected > 0 ? ((dropped / expected) * 100).toFixed(1) : '0.0';
  console.log(
    `\nsim done. connected=${players.length}/${PLAYERS} answers=${answered}/${expected} dropped=${dropped} (${dropPct}%)`,
  );
  console.log(
    pubErrors.total > 0
      ? `publish errors: ${pubErrors.total} ${JSON.stringify(pubErrors.byCode)}`
      : 'publish errors: none',
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
