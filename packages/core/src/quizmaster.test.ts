import { beforeEach, describe, expect, it } from 'vitest';
import type { Choice, QuestionDef, QuizConfig, ScoreboardEntry } from './protocol';
import {
  Quizmaster,
  type Broadcaster,
  type ControlHistoryEntry,
  type InboundAnswer,
  type QuizStore,
} from './quizmaster';

// --- Mocks ------------------------------------------------------------------
class MockBroadcaster implements Broadcaster {
  ts = 1_000_000;
  control: ControlHistoryEntry[] = [];
  async publishControl(msg: Parameters<Broadcaster['publishControl']>[0]): Promise<number> {
    const serverTs = this.ts;
    this.ts += 1000;
    this.control.push({ msg, serverTs });
    return serverTs;
  }
}

class MockStore implements QuizStore {
  config: QuizConfig | undefined;
  phase = { phase: 'lobby' as string, idx: -1 };
  tally: Record<Choice, number> = { A: 0, B: 0, C: 0, D: 0 };
  scoreboard = new Map<string, ScoreboardEntry>();
  setConfig(c: QuizConfig) {
    this.config = c;
  }
  setPhase(p: string, idx: number) {
    this.phase = { phase: p, idx };
  }
  resetTally() {
    this.tally = { A: 0, B: 0, C: 0, D: 0 };
  }
  setTally(c: Choice, n: number) {
    this.tally[c] = n;
  }
  setScoreboardEntry(id: string, e: ScoreboardEntry) {
    this.scoreboard.set(id, { ...e });
  }
}

const IDENTITY = (n: number) => Array.from({ length: n }, (_, i) => i);

const QUESTIONS: QuestionDef[] = [
  { prompt: 'Q0', options: ['a', 'b', 'c', 'd'], correctIndex: 0, limitMs: 20_000 }, // correct 'A'
  { prompt: 'Q1', options: ['a', 'b', 'c', 'd'], correctIndex: 1, limitMs: 20_000 }, // correct 'B'
];
const CONFIG: QuizConfig = {
  scoringAlgoId: 'classic',
  questionCount: 2,
  defaultLimitMs: 20_000,
  streakEnabled: false,
};

function makeQuizmaster(questions = QUESTIONS, config = CONFIG) {
  const broadcaster = new MockBroadcaster();
  const store = new MockStore();
  const qm = new Quizmaster({
    quizId: 'dev',
    questions,
    config,
    broadcaster,
    store,
    permute: IDENTITY,
  });
  return { qm, broadcaster, store };
}

describe('quizmaster — question loop & scoring', () => {
  it('runs a full quiz, scoring accuracy + speed with the server clock', async () => {
    const { qm, broadcaster, store } = makeQuizmaster();
    qm.init();

    await qm.askNext(); // Q0 (correct A); T₀ = its control timestamp
    const t0q0 = broadcaster.control.at(-1)!.serverTs;
    qm.ingest({ clientId: 'p:alice', data: { idx: 0, choice: 'A' }, serverTs: t0q0 + 2_000 }); // 950
    qm.ingest({ clientId: 'p:bob', data: { idx: 0, choice: 'B' }, serverTs: t0q0 + 5_000 }); // wrong → 0
    qm.ingest({ clientId: 'p:carol', data: { idx: 0, choice: 'A' }, serverTs: t0q0 + 30_000 }); // late → 0
    qm.ingest({ clientId: 'p:alice', data: { idx: 0, choice: 'B' }, serverTs: t0q0 + 3_000 }); // dupe → ignored

    expect(store.tally).toEqual({ A: 2, B: 1, C: 0, D: 0 }); // alice+carol on A, bob on B; dupe not counted

    await qm.lock();
    await qm.reveal();

    await qm.askNext(); // Q1 (correct B)
    const t0q1 = broadcaster.control.at(-1)!.serverTs;
    expect(store.tally).toEqual({ A: 0, B: 0, C: 0, D: 0 }); // reset for the new question
    qm.ingest({ clientId: 'p:alice', data: { idx: 1, choice: 'B' }, serverTs: t0q1 + 1_000 }); // 975
    qm.ingest({ clientId: 'p:bob', data: { idx: 1, choice: 'B' }, serverTs: t0q1 + 1_000 }); // 975

    await qm.lock();
    await qm.reveal();
    await qm.podium();

    const scores = Object.fromEntries([...store.scoreboard].map(([id, e]) => [id, e.score]));
    expect(scores).toEqual({ 'p:alice': 1925, 'p:bob': 975, 'p:carol': 0 });
    // Answer log keeps every first answer (incl. wrong + late), not the dupe.
    expect(qm.getAnswerLog()).toHaveLength(5);
  });

  it('attributes the answer log per question so a new question starts from zero (premature-lock regression)', async () => {
    // The host auto-locks when everyone present has answered THIS question. That
    // signal must be the engine's per-idx answer count, not a flag that lags a
    // transition — otherwise the previous question's answers trip an immediate
    // lock on the next one, dropping slower answerers (2026-07-13 4-agent smoke).
    const { qm, broadcaster } = makeQuizmaster();
    qm.init();

    await qm.askNext(); // Q0
    const t0q0 = broadcaster.control.at(-1)!.serverTs;
    for (const id of ['a:grok', 'a:opus', 'a:sonnet']) {
      qm.ingest({ clientId: id, data: { idx: 0, choice: 'A' }, serverTs: t0q0 + 1_000 });
    }
    const answeredFor = (idx: number) => qm.getAnswerLog().filter((e) => e.idx === idx).length;
    expect(answeredFor(0)).toBe(3);

    await qm.lock();
    await qm.reveal();
    await qm.askNext(); // Q1

    // The moment Q1 opens, its per-idx count is 0 — the three Q0 answers do NOT
    // carry over, so a host gating on answeredFor(1) won't lock before anyone has
    // actually answered Q1.
    expect(answeredFor(1)).toBe(0);

    const t0q1 = broadcaster.control.at(-1)!.serverTs;
    qm.ingest({ clientId: 'a:grok', data: { idx: 1, choice: 'B' }, serverTs: t0q1 + 1_000 });
    expect(answeredFor(1)).toBe(1); // only the one real Q1 answer, not 4
  });

  it('derives species from the clientId prefix on the scoreboard', async () => {
    const { qm, broadcaster, store } = makeQuizmaster();
    qm.init();
    await qm.askNext();
    const t0 = broadcaster.control.at(-1)!.serverTs;
    qm.setDisplayName('a:fable', 'Matt Fable');
    qm.ingest({ clientId: 'a:fable', data: { idx: 0, choice: 'A' }, serverTs: t0 + 500 });
    qm.ingest({ clientId: 'p:priya', data: { idx: 0, choice: 'A' }, serverTs: t0 + 500 });
    expect(store.scoreboard.get('a:fable')).toMatchObject({ name: 'Matt Fable', kind: 'agent' });
    expect(store.scoreboard.get('p:priya')).toMatchObject({ kind: 'human' });
  });

  it('ignores answers outside the open question (wrong idx / before asking / after reveal)', async () => {
    const { qm, broadcaster } = makeQuizmaster();
    qm.init();
    qm.ingest({ clientId: 'p:early', data: { idx: 0, choice: 'A' }, serverTs: 5 }); // before asking
    await qm.askNext();
    const t0 = broadcaster.control.at(-1)!.serverTs;
    qm.ingest({ clientId: 'p:wrongq', data: { idx: 9, choice: 'A' }, serverTs: t0 + 100 }); // wrong idx
    await qm.lock();
    await qm.reveal();
    qm.ingest({ clientId: 'p:late', data: { idx: 0, choice: 'A' }, serverTs: t0 + 100 }); // after reveal
    expect(qm.getAnswerLog()).toHaveLength(0);
  });
});

describe('quizmaster — T₀ race', () => {
  it('buffers answers that arrive before T₀ is captured, then scores them', async () => {
    const store = new MockStore();
    let releaseT0: () => void = () => undefined;
    const broadcaster: Broadcaster = {
      publishControl: () =>
        new Promise<number>((resolve) => {
          releaseT0 = () => resolve(2_000_000);
        }),
    };
    const qm = new Quizmaster({
      quizId: 'dev',
      questions: QUESTIONS,
      config: CONFIG,
      broadcaster,
      store,
      permute: IDENTITY,
    });
    qm.init();

    const asking = qm.askNext(); // hangs awaiting T₀
    // A fast answer arrives BEFORE T₀ lands — must be held, not dropped.
    qm.ingest({ clientId: 'p:fast', data: { idx: 0, choice: 'A' }, serverTs: 2_000_500 });
    expect(qm.getAnswerLog()).toHaveLength(0);

    releaseT0();
    await asking;

    const log = qm.getAnswerLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ clientId: 'p:fast', correct: true, elapsedMs: 500 });
  });
});

describe('quizmaster — 300-answer burst (§B2 gate)', () => {
  it('scores a 300-answer burst correctly with no drops or double-counts', async () => {
    const { qm, broadcaster, store } = makeQuizmaster();
    qm.init();
    await qm.askNext(); // Q0, correct 'A'
    const t0 = broadcaster.control.at(-1)!.serverTs;

    // 300 unique players answer within 3s; 200 correct (A), 100 wrong (B).
    for (let i = 0; i < 300; i++) {
      const correct = i < 200;
      qm.ingest({
        clientId: `p:player-${i}`,
        data: { idx: 0, choice: correct ? 'A' : 'B' },
        serverTs: t0 + (i % 3000),
      });
    }
    // Each player tries again — all must be ignored (first-answer-wins).
    for (let i = 0; i < 300; i++) {
      qm.ingest({ clientId: `p:player-${i}`, data: { idx: 0, choice: 'C' }, serverTs: t0 + 4_000 });
    }

    expect(qm.getAnswerLog()).toHaveLength(300);
    expect(store.tally).toEqual({ A: 200, B: 100, C: 0, D: 0 });
    expect(store.scoreboard.size).toBe(300);

    const standings = qm.getStandings();
    expect(standings).toHaveLength(300);
    expect(standings.filter((s) => s.score > 0)).toHaveLength(200); // only correct answers score
    expect(standings.every((s) => s.correctCount <= 1)).toBe(true);
  });
});

describe('quizmaster — recovery from history (§B2.3)', () => {
  let live: ReturnType<typeof makeQuizmaster>;
  const fed: InboundAnswer[] = [];

  function feed(qm: Quizmaster, a: InboundAnswer) {
    fed.push(a);
    qm.ingest(a);
  }

  beforeEach(() => {
    fed.length = 0;
    live = makeQuizmaster();
  });

  it('rebuilds identical standings + scoreboard for a completed quiz', async () => {
    const { qm, broadcaster } = live;
    qm.init();
    await qm.askNext();
    const t0q0 = broadcaster.control.at(-1)!.serverTs;
    feed(qm, { clientId: 'p:alice', data: { idx: 0, choice: 'A' }, serverTs: t0q0 + 2_000 });
    feed(qm, { clientId: 'p:bob', data: { idx: 0, choice: 'A' }, serverTs: t0q0 + 8_000 });
    await qm.lock();
    await qm.reveal();
    await qm.askNext();
    const t0q1 = broadcaster.control.at(-1)!.serverTs;
    feed(qm, { clientId: 'p:alice', data: { idx: 1, choice: 'C' }, serverTs: t0q1 + 1_000 }); // wrong
    feed(qm, { clientId: 'p:bob', data: { idx: 1, choice: 'B' }, serverTs: t0q1 + 3_000 });
    await qm.lock();
    await qm.reveal();
    await qm.podium();

    // A fresh quizmaster recovers from the same channel history.
    const revived = makeQuizmaster();
    revived.qm.recover(broadcaster.control, fed);

    expect(revived.qm.getState()).toEqual(live.qm.getState());
    expect(revived.qm.getStandings()).toEqual(live.qm.getStandings());
    expect(Object.fromEntries(revived.store.scoreboard)).toEqual(
      Object.fromEntries(live.store.scoreboard),
    );
  });

  it('recovers an in-flight question (correct letter derived from published options)', async () => {
    // Shuffle options so the correct answer is NOT at its original index — this
    // exercises correct-letter derivation by matching published option text.
    const shuffled = makeQuizmaster(QUESTIONS, CONFIG);
    // reverse permutation: correctIndex 0 ('a') moves to the last slot
    const qmShuf = new Quizmaster({
      quizId: 'dev',
      questions: QUESTIONS,
      config: CONFIG,
      broadcaster: shuffled.broadcaster,
      store: shuffled.store,
      permute: (n) => Array.from({ length: n }, (_, i) => n - 1 - i),
    });
    qmShuf.init();
    await qmShuf.askNext(); // Q0 correct 'a' now published in slot D
    const q0 = shuffled.broadcaster.control.at(-1)!;
    expect(q0.msg.type === 'question' && q0.msg.options[3]).toBe('a'); // 'a' is now 'D'
    const t0 = q0.serverTs;
    const inflight: InboundAnswer[] = [
      { clientId: 'p:alice', data: { idx: 0, choice: 'D' }, serverTs: t0 + 1_000 }, // correct (a→D)
      { clientId: 'p:bob', data: { idx: 0, choice: 'A' }, serverTs: t0 + 1_000 }, // wrong
    ];
    for (const a of inflight) qmShuf.ingest(a);

    const revived = makeQuizmaster();
    revived.qm.recover(shuffled.broadcaster.control, inflight);

    expect(revived.qm.getState()).toEqual({ phase: 'asking', questionIdx: 0 });
    expect(Object.fromEntries(revived.store.scoreboard)).toEqual(
      Object.fromEntries(shuffled.store.scoreboard),
    );
    // alice (correct via a→D) scored, bob (wrong) zero.
    expect(revived.store.scoreboard.get('p:alice')!.score).toBeGreaterThan(0);
    expect(revived.store.scoreboard.get('p:bob')!.score).toBe(0);
  });
});
