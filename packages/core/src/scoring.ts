// Scoring (§B2.6). Pure, pluggable functions + counterfactual recompute.
//
// The window/grace rule lives HERE (not only in the quizmaster) so that live
// scoring and the end-of-quiz counterfactual recompute share ONE code path —
// recompute(log) must equal the live totals under the same algorithm.

import type { AnswerLogEntry } from './protocol';

export type ScoreInput = {
  correct: boolean;
  elapsedMs: number;
  limitMs: number;
  /** Consecutive-correct run length INCLUDING this question (0 if wrong). */
  streak: number;
};

export type ScoringAlgo = {
  id: string;
  label: string;
  blurb: string;
  /** Base points for one answer, ignoring the streak modifier. 0 if wrong/late. */
  score: (a: ScoreInput) => number;
};

/** Answers later than limit + this grace score 0 (§B2.2). */
export const GRACE_MS = 250;

export const DEFAULT_ALGO_ID = 'classic';

/** Clamped elapsed/limit in [0,1], or null if beyond the window (⇒ score 0). */
function windowRatio(a: ScoreInput): number | null {
  if (a.elapsedMs > a.limitMs + GRACE_MS) return null;
  return Math.min(1, Math.max(0, a.elapsedMs / a.limitMs));
}

export const SCORING_ALGOS: Record<string, ScoringAlgo> = {
  classic: {
    id: 'classic',
    label: 'Classic',
    blurb: "Kahoot's formula — accuracy with a speed bonus.",
    score: (a) => {
      if (!a.correct) return 0;
      const r = windowRatio(a);
      return r === null ? 0 : Math.round(1000 * (1 - r / 2));
    },
  },
  'fastest-finger': {
    id: 'fastest-finger',
    label: 'Fastest finger',
    blurb: 'Speed premium — instant ≈ 1000, buzzer-beater ≈ 110.',
    score: (a) => {
      if (!a.correct) return 0;
      const r = windowRatio(a);
      return r === null ? 0 : Math.round(1000 * Math.exp(-2.2 * r));
    },
  },
  steady: {
    id: 'steady',
    label: 'Steady',
    blurb: 'Pure accuracy — 1000 flat; cumulative time breaks ties.',
    score: (a) => {
      if (!a.correct) return 0;
      return windowRatio(a) === null ? 0 : 1000;
    },
  },
};

export function getAlgo(id: string): ScoringAlgo | undefined {
  return SCORING_ALGOS[id];
}

/** For the creation-screen picker (id + human copy). */
export function listAlgos(): { id: string; label: string; blurb: string }[] {
  return Object.values(SCORING_ALGOS).map(({ id, label, blurb }) => ({ id, label, blurb }));
}

/** The streak modifier (§B2.6): base × min(1 + 0.1·streak, 1.5). Only on nonzero scores. */
export function applyStreak(base: number, streak: number, streakEnabled: boolean): number {
  if (!streakEnabled || base === 0) return base;
  return Math.round(base * Math.min(1 + 0.1 * streak, 1.5));
}

/** Score one answer under an algorithm, with the optional streak modifier. */
export function scoreQuestion(
  algo: ScoringAlgo,
  input: ScoreInput,
  streakEnabled: boolean,
): number {
  return applyStreak(algo.score(input), input.streak, streakEnabled);
}

// --- Counterfactual recompute (§B2.6) ---------------------------------------
export type Standing = {
  clientId: string;
  score: number;
  correctCount: number;
  /** Sum of elapsedMs over correct-in-window answers; tiebreak (faster wins). */
  totalTimeMs: number;
};

/** Per-question time limit lookup, by question index. */
export type LimitLookup = (idx: number) => number;

/**
 * Replay the raw answer log under one algorithm and return ranked standings.
 * Streak is folded per player in question order, so this reproduces exactly what
 * live scoring produced — the invariant the counterfactual panel relies on.
 */
export function recomputeStandings(
  log: AnswerLogEntry[],
  limitOf: LimitLookup,
  algoId: string,
  streakEnabled: boolean,
): Standing[] {
  const algo = getAlgo(algoId);
  if (!algo) throw new Error(`unknown scoring algo: ${algoId}`);

  const byClient = new Map<string, AnswerLogEntry[]>();
  for (const entry of log) {
    const list = byClient.get(entry.clientId) ?? [];
    list.push(entry);
    byClient.set(entry.clientId, list);
  }

  const standings: Standing[] = [];
  for (const [clientId, entries] of byClient) {
    entries.sort((a, b) => a.idx - b.idx);
    let score = 0;
    let streak = 0;
    let correctCount = 0;
    let totalTimeMs = 0;
    for (const e of entries) {
      const inWindow = e.correct && e.elapsedMs <= limitOf(e.idx) + GRACE_MS;
      streak = inWindow ? streak + 1 : 0;
      score += scoreQuestion(
        algo,
        {
          correct: e.correct,
          elapsedMs: e.elapsedMs,
          limitMs: limitOf(e.idx),
          streak,
        },
        streakEnabled,
      );
      if (inWindow) {
        correctCount += 1;
        totalTimeMs += e.elapsedMs;
      }
    }
    standings.push({ clientId, score, correctCount, totalTimeMs });
  }
  return rankStandings(standings);
}

/** Rank by score desc, then cumulative time asc (faster breaks ties, e.g. `steady`). */
export function rankStandings(standings: Standing[]): Standing[] {
  return [...standings].sort((a, b) => b.score - a.score || a.totalTimeMs - b.totalTimeMs);
}

/** Ranked standings under EVERY algorithm — the analysis-phase payload (§B2.6). */
export function counterfactual(
  log: AnswerLogEntry[],
  limitOf: LimitLookup,
  streakEnabled: boolean,
): Record<string, Standing[]> {
  const out: Record<string, Standing[]> = {};
  for (const id of Object.keys(SCORING_ALGOS)) {
    out[id] = recomputeStandings(log, limitOf, id, streakEnabled);
  }
  return out;
}
