import { describe, expect, it } from 'vitest';
import type { AnswerLogEntry } from './protocol';
import {
  counterfactual,
  getAlgo,
  GRACE_MS,
  recomputeStandings,
  scoreQuestion,
  SCORING_ALGOS,
  type LimitLookup,
} from './scoring';

const LIMIT = 20_000;
const at = (elapsedMs: number, correct = true) => ({
  correct,
  elapsedMs,
  limitMs: LIMIT,
  streak: 0,
});

describe('classic', () => {
  const algo = getAlgo('classic')!;
  it('t=0 → 1000, t=limit → 500, t=limit/2 → 750', () => {
    expect(algo.score(at(0))).toBe(1000);
    expect(algo.score(at(LIMIT))).toBe(500);
    expect(algo.score(at(LIMIT / 2))).toBe(750);
  });
  it('wrong answers score 0', () => {
    expect(algo.score(at(0, false))).toBe(0);
  });
});

describe('fastest-finger', () => {
  const algo = getAlgo('fastest-finger')!;
  it('instant ≈ 1000, buzzer-beater ≈ 110', () => {
    expect(algo.score(at(0))).toBe(1000);
    expect(algo.score(at(LIMIT))).toBe(Math.round(1000 * Math.exp(-2.2)));
    expect(algo.score(at(LIMIT))).toBeLessThan(120);
  });
});

describe('steady', () => {
  const algo = getAlgo('steady')!;
  it('flat 1000 for correct, 0 for wrong', () => {
    expect(algo.score(at(0))).toBe(1000);
    expect(algo.score(at(LIMIT))).toBe(1000);
    expect(algo.score(at(0, false))).toBe(0);
  });
});

describe('window / grace (§B2.2)', () => {
  it('within grace still scores (clamped); beyond grace scores 0', () => {
    for (const algo of Object.values(SCORING_ALGOS)) {
      expect(algo.score(at(LIMIT + GRACE_MS))).toBeGreaterThan(0);
      expect(algo.score(at(LIMIT + GRACE_MS + 1))).toBe(0);
    }
  });
});

describe('streak modifier', () => {
  const algo = getAlgo('steady')!; // base 1000 makes the multiplier easy to read
  it('1 + 0.1·streak, capped at 1.5', () => {
    expect(scoreQuestion(algo, { ...at(0), streak: 1 }, true)).toBe(1100);
    expect(scoreQuestion(algo, { ...at(0), streak: 5 }, true)).toBe(1500);
    expect(scoreQuestion(algo, { ...at(0), streak: 50 }, true)).toBe(1500); // capped
  });
  it('does nothing when disabled or when the base is 0', () => {
    expect(scoreQuestion(algo, { ...at(0), streak: 5 }, false)).toBe(1000);
    expect(scoreQuestion(algo, { ...at(0, false), streak: 5 }, true)).toBe(0);
  });
});

// A log with correct/wrong/late answers and a skipped question, across species.
const LOG: AnswerLogEntry[] = [
  { clientId: 'p:alice', idx: 0, choice: 'A', correct: true, elapsedMs: 2_000 },
  { clientId: 'p:alice', idx: 1, choice: 'B', correct: true, elapsedMs: 4_000 },
  { clientId: 'p:alice', idx: 2, choice: 'C', correct: false, elapsedMs: 5_000 },
  { clientId: 'p:bob', idx: 0, choice: 'A', correct: true, elapsedMs: 10_000 },
  { clientId: 'p:bob', idx: 2, choice: 'D', correct: true, elapsedMs: 1_000 }, // skipped q1
  { clientId: 'a:fable', idx: 0, choice: 'A', correct: true, elapsedMs: 500 },
  { clientId: 'a:fable', idx: 1, choice: 'B', correct: true, elapsedMs: 500 },
  { clientId: 'a:fable', idx: 2, choice: 'C', correct: true, elapsedMs: 100_000 }, // late → 0
];
const limitOf: LimitLookup = () => LIMIT;

/** Independent reference: fold the log question-by-question (as the quizmaster
 *  does live), so matching recompute validates the counterfactual invariant. */
function liveTotals(algoId: string, streakEnabled: boolean): Map<string, number> {
  const algo = getAlgo(algoId)!;
  const totals = new Map<string, number>();
  const streaks = new Map<string, number>();
  const maxIdx = Math.max(...LOG.map((e) => e.idx));
  for (let idx = 0; idx <= maxIdx; idx++) {
    for (const e of LOG.filter((x) => x.idx === idx)) {
      const inWindow = e.correct && e.elapsedMs <= limitOf(idx) + GRACE_MS;
      const streak = inWindow ? (streaks.get(e.clientId) ?? 0) + 1 : 0;
      streaks.set(e.clientId, streak);
      const s = scoreQuestion(
        algo,
        { correct: e.correct, elapsedMs: e.elapsedMs, limitMs: limitOf(idx), streak },
        streakEnabled,
      );
      totals.set(e.clientId, (totals.get(e.clientId) ?? 0) + s);
    }
  }
  return totals;
}

describe('recomputeStandings', () => {
  it('classic totals are correct', () => {
    const s = recomputeStandings(LOG, limitOf, 'classic', false);
    const byId = Object.fromEntries(s.map((x) => [x.clientId, x.score]));
    // alice: 950 + 900 + 0 ; fable: 988 + 988 + 0(late) ; bob: 750 + 975
    expect(byId['p:alice']).toBe(1850);
    expect(byId['a:fable']).toBe(1976);
    expect(byId['p:bob']).toBe(1725);
  });

  it('ranks by score desc, then by cumulative time asc (tiebreak)', () => {
    const tie: AnswerLogEntry[] = [
      { clientId: 'p:slow', idx: 0, choice: 'A', correct: true, elapsedMs: 9_000 },
      { clientId: 'p:fast', idx: 0, choice: 'A', correct: true, elapsedMs: 1_000 },
    ];
    const s = recomputeStandings(tie, limitOf, 'steady', false); // both 1000
    expect(s.map((x) => x.clientId)).toEqual(['p:fast', 'p:slow']);
  });

  it('counterfactual recompute matches live scoring for every algo × streak (§B2.6)', () => {
    for (const algoId of Object.keys(SCORING_ALGOS)) {
      for (const streakEnabled of [false, true]) {
        const live = liveTotals(algoId, streakEnabled);
        const recomputed = recomputeStandings(LOG, limitOf, algoId, streakEnabled);
        for (const s of recomputed) {
          expect(s.score, `${algoId} streak=${streakEnabled} ${s.clientId}`).toBe(
            live.get(s.clientId),
          );
        }
      }
    }
  });
});

describe('counterfactual', () => {
  it('returns ranked standings under every algorithm', () => {
    const cf = counterfactual(LOG, limitOf, false);
    expect(Object.keys(cf).sort()).toEqual(['classic', 'fastest-finger', 'steady']);
    for (const standings of Object.values(cf)) {
      const scores = standings.map((s) => s.score);
      expect([...scores]).toEqual([...scores].sort((a, b) => b - a)); // ranked desc
    }
  });

  it('a different algorithm can crown a different winner', () => {
    // Fable answers fastest; under fastest-finger it should win, but a slower,
    // more-consistent player can win under steady.
    const log: AnswerLogEntry[] = [
      { clientId: 'a:fable', idx: 0, choice: 'A', correct: true, elapsedMs: 200 },
      { clientId: 'a:fable', idx: 1, choice: 'A', correct: false, elapsedMs: 200 },
      { clientId: 'p:priya', idx: 0, choice: 'A', correct: true, elapsedMs: 9_000 },
      { clientId: 'p:priya', idx: 1, choice: 'A', correct: true, elapsedMs: 9_000 },
    ];
    const cf = counterfactual(log, limitOf, false);
    expect(cf['fastest-finger']![0]!.clientId).toBe('a:fable'); // one blazing-fast correct
    expect(cf['steady']![0]!.clientId).toBe('p:priya'); // two correct beats one
  });
});
