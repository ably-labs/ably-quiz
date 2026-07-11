// S1 gate — prove that JWTs issued by /api/ably-auth authenticate against REAL
// Ably and enforce the §B2.5 capability matrix. Mirrors the actual quiz paths:
// a host broadcasts control on the main channel to a player, and a player
// publishes an answer to the fan-in channel that only the host subscribes to.
// Also checks a capability denial (player may NOT publish to the main channel).
//
//   # with the web server built and running on AUTH_BASE_URL:
//   pnpm --dir spikes/auth-e2e verify

import { fileURLToPath } from 'node:url';
import * as Ably from 'ably';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: fileURLToPath(new URL('../../.env.local', import.meta.url)) });

const BASE = process.env.AUTH_BASE_URL ?? 'http://127.0.0.1:3100';
const QUIZ = 'dev';

type TokenResp = { token: string; clientId: string; kind: string };

const results: { name: string; ok: boolean; note: string }[] = [];
const check = (name: string, ok: boolean, note = '') => results.push({ name, ok, note });

async function getToken(body: Record<string, unknown>): Promise<TokenResp> {
  const r = await fetch(`${BASE}/api/ably-auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`auth ${r.status}: ${await r.text()}`);
  return (await r.json()) as TokenResp;
}

function client(token: string): Ably.Realtime {
  return new Ably.Realtime({ authCallback: (_params, cb) => cb(null, token) });
}

/** Subscribe first (await attach), then return a getter for the next message. */
async function subscribeOnce(
  channel: Ably.RealtimeChannel,
  name: string,
  timeoutMs: number,
): Promise<() => Promise<Ably.Message | null>> {
  let resolve!: (m: Ably.Message | null) => void;
  const p = new Promise<Ably.Message | null>((r) => {
    resolve = r;
  });
  await channel.subscribe(name, (m) => resolve(m));
  const timer = setTimeout(() => resolve(null), timeoutMs);
  void p.finally(() => clearTimeout(timer));
  return () => p;
}

async function main(): Promise<void> {
  // 1. Issue tokens from the real endpoint (hosting is open — no secret).
  const host = await getToken({ quizId: QUIZ, role: 'host' });
  const player = await getToken({ quizId: QUIZ, role: 'player', clientId: 'e2e-player' });
  check(
    'host token has h: clientId (no secret needed)',
    host.clientId.startsWith('h:'),
    host.clientId,
  );
  check('player token has p: clientId', player.clientId === 'p:e2e-player', player.clientId);

  const hostClient = client(host.token);
  const playerClient = client(player.token);
  const mainCh = `quiz:${QUIZ}`;
  const answersCh = `quiz-answers:${QUIZ}`;

  // 2. Control broadcast: host publishes on main, player receives (real question path).
  const waitQuestion = await subscribeOnce(playerClient.channels.get(mainCh), 'question', 5000);
  await hostClient.channels.get(mainCh).publish('question', { idx: 0 });
  check('control broadcast: host→main, player receives', (await waitQuestion()) !== null);

  // 3. Fan-in: host subscribes answers, player publishes its answer.
  const waitAnswer = await subscribeOnce(hostClient.channels.get(answersCh), 'answer', 5000);
  await playerClient.channels.get(answersCh).publish('answer', { choice: 'A' });
  check('fan-in: player→answers, host receives', (await waitAnswer()) !== null);

  // 4. Capability denial: a player must NOT be able to publish on the main channel.
  try {
    await playerClient.channels.get(mainCh).publish('question', { spoofed: true });
    check('player publish to main DENIED', false, 'publish succeeded!');
  } catch {
    check('player publish to main DENIED (capability)', true);
  }

  hostClient.close();
  playerClient.close();

  let allOk = true;
  console.log('\nS1 gate — pub/sub via issued JWTs:');
  for (const { name, ok, note } of results) {
    console.log(`  ${ok ? '✓' : '✗'} ${name}${note ? ` — ${note}` : ''}`);
    if (!ok) allOk = false;
  }
  console.log(allOk ? '\nGATE PASS' : '\nGATE FAIL');
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
