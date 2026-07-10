// S1.3 — Does the per-message server timestamp survive server-side batching?
//
// The quiz's fairness clock is each answer message's Ably server timestamp
// (BRIEF §B2.1/§B2.2). Answers publish to the batched `quiz-answers` namespace.
// The docs don't state whether messages inside a batch keep their own
// timestamps, so we measure it two ways:
//   1. spaced   — 3 messages from ONE connection within a 200ms window.
//   2. burst    — N messages from N DIFFERENT connections (like N players)
//                 fired simultaneously, which actually forces the batcher.
// A `quiz` (non-batched) channel is the control.
//
//   pnpm --dir spikes/ably-batching install
//   pnpm --dir spikes/ably-batching batch-test

import { fileURLToPath } from 'node:url';
import * as Ably from 'ably';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: fileURLToPath(new URL('../../.env.local', import.meta.url)) });

const KEY = process.env.ABLY_API_KEY;
if (!KEY || !KEY.includes(':')) {
  console.error('ABLY_API_KEY missing or not a full key in repo-root .env.local');
  process.exit(1);
}

type Received = {
  seq: number | null;
  serverTs: number;
  id: string | undefined;
  arrivalMs: number;
  dataIsArray: boolean;
};

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function whenConnected(client: Ably.Realtime): Promise<void> {
  return new Promise((res) => {
    if (client.connection.state === 'connected') return res();
    client.connection.once('connected', () => res());
  });
}

function record(received: Received[], t0: number, msg: Ably.Message): void {
  const data = msg.data as unknown;
  const seq =
    data && typeof data === 'object' && 'seq' in data && typeof data.seq === 'number'
      ? data.seq
      : null;
  received.push({
    seq,
    serverTs: msg.timestamp ?? 0,
    id: msg.id,
    arrivalMs: Math.round(performance.now() - t0),
    dataIsArray: Array.isArray(data),
  });
}

// One connection publishes `schedule.length` messages at the given ms offsets.
async function spacedProbe(channelName: string, schedule: number[]): Promise<Received[]> {
  const sub = new Ably.Realtime({ key: KEY, clientId: `sub-${channelName}` });
  const pub = new Ably.Realtime({ key: KEY, clientId: `pub-${channelName}`, echoMessages: false });
  const received: Received[] = [];
  const subCh = sub.channels.get(channelName);
  const t0 = performance.now();
  await subCh.subscribe((msg) => record(received, t0, msg));

  const pubCh = pub.channels.get(channelName);
  await Promise.allSettled(
    schedule.map(
      (d, i) =>
        new Promise<void>((res, rej) => {
          setTimeout(() => pubCh.publish('answer', { seq: i }).then(() => res(), rej), d);
        }),
    ),
  );
  await delay(1500);
  sub.close();
  pub.close();
  return received.sort((a, b) => a.serverTs - b.serverTs);
}

// N separate connections (like N players) each publish ONE message at once.
async function burstProbe(channelName: string, nConns: number): Promise<Received[]> {
  const sub = new Ably.Realtime({ key: KEY, clientId: `sub-${channelName}` });
  const received: Received[] = [];
  const t0 = performance.now();
  await sub.channels.get(channelName).subscribe((msg) => record(received, t0, msg));

  const pubs = Array.from(
    { length: nConns },
    (_, i) => new Ably.Realtime({ key: KEY, clientId: `p${i}`, echoMessages: false }),
  );
  await Promise.all(pubs.map(whenConnected)); // connect first, then fire together
  await Promise.allSettled(
    pubs.map((p, i) => p.channels.get(channelName).publish('answer', { seq: i })),
  );

  await delay(2000);
  sub.close();
  pubs.forEach((p) => p.close());
  return received.sort((a, b) => a.serverTs - b.serverTs);
}

function report(label: string, channelName: string, recs: Received[], expected: number): void {
  console.log(`\n### ${label}  (channel: ${channelName})`);
  console.log(`received ${recs.length}/${expected} message(s)`);
  if (recs.length === 0) return;
  const base = recs[0]!.serverTs;
  const distinctTs = new Set(recs.map((r) => r.serverTs)).size;
  const tsSpread = recs[recs.length - 1]!.serverTs - base;
  const arrivals = recs.map((r) => r.arrivalMs);
  const arrSpread = Math.max(...arrivals) - Math.min(...arrivals);
  const arrBuckets = new Set(recs.map((r) => Math.round(r.arrivalMs / 20))).size;
  // Show at most the first few rows to keep bursts readable.
  for (const r of recs.slice(0, 5)) {
    console.log(
      `  seq=${r.seq ?? '?'} serverTs=${r.serverTs} (+${r.serverTs - base}ms) arrival=${r.arrivalMs}ms id=${r.id ?? '(none)'} dataIsArray=${r.dataIsArray}`,
    );
  }
  if (recs.length > 5) console.log(`  … (${recs.length - 5} more)`);
  console.log(
    `  → distinct server timestamps: ${distinctTs}/${recs.length} · ts spread ${tsSpread}ms`,
  );
  console.log(`  → arrival spread ${arrSpread}ms across ~${arrBuckets} 20ms-bucket(s)`);
}

async function main(): Promise<void> {
  const key = stamp();
  console.log(`S1.3 batch-timestamp probe. run=${key}`);

  const answersCh = `quiz-answers:batch-ts-${key}`;
  const controlCh = `quiz:batch-ctrl-${key}`;
  const burstCh = `quiz-answers:batch-burst-${key}`;
  const N = 20;

  const spaced = await spacedProbe(answersCh, [0, 40, 80]);
  const control = await spacedProbe(controlCh, [0, 40, 80]);
  const burst = await burstProbe(burstCh, N);

  report('BATCHED spaced — quiz-answers @200ms', answersCh, spaced, 3);
  report('CONTROL spaced — quiz (no batching)', controlCh, control, 3);
  report(`BATCHED burst — ${N} connections × 1 msg`, burstCh, burst, N);

  const distinctBurst = new Set(burst.map((r) => r.serverTs)).size;
  console.log('\n=== FINDING ===');
  if (burst.length >= 2 && distinctBurst === burst.length) {
    console.log(
      `Per-message server timestamps are PRESERVED inside a batch (${distinctBurst}/${burst.length} distinct under a ${N}-connection burst). Use each answer's own server timestamp as the fairness clock — no quantization.`,
    );
  } else if (burst.length >= 2 && distinctBurst < burst.length) {
    console.log(
      `Only ${distinctBurst}/${burst.length} distinct timestamps under batching → some quantization. Per §B2.1 accept ±batchingInterval (uniform/fair), or lower the interval / drop batching.`,
    );
  } else {
    console.log(`Inconclusive: received ${burst.length}/${N} — inspect message shape above.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
