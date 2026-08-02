// Scoring (§B2.6). Pure, pluggable functions + counterfactual recompute.
//
// The window/grace rule lives HERE (not only in the quizmaster) so that live
// scoring and the end-of-quiz counterfactual recompute share ONE code path —
// recompute(log) must equal the live totals under the same algorithm.

import type { AnswerLogEntry, ScoreboardEntry } from './protocol';

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
    blurb: 'Right answers score, faster ones score more. Pick this for the usual quiz balance.',
    score: (a) => {
      if (!a.correct) return 0;
      const r = windowRatio(a);
      return r === null ? 0 : Math.round(1000 * (1 - r / 2));
    },
  },
  'fastest-finger': {
    id: 'fastest-finger',
    label: 'Fastest finger',
    blurb: 'Speed dominates; a split-second matters. Pick this for frantic, buzzer-race energy.',
    score: (a) => {
      if (!a.correct) return 0;
      const r = windowRatio(a);
      return r === null ? 0 : Math.round(1000 * Math.exp(-2.2 * r));
    },
  },
  steady: {
    id: 'steady',
    label: 'Steady',
    blurb:
      "Only accuracy counts; time just breaks ties. Pick this so careful thinkers aren't punished.",
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

// --- The double game (§S7.3) ------------------------------------------------
// Two competitions run at once, so nobody's night is "I lost to a robot":
// Carbon vs Silicon as TEAMS, and the best human as a title of its own. Both are
// derived from the scoreboard that's already on the wire — no new state to
// publish, and (since the scoreboard's scores only move at reveal, §S7.1) they
// can't twitch mid-question either.

export type TeamStanding = {
  /** Members who have answered at least one question — the per-capita divisor. */
  players: number;
  total: number;
  /** Points per player: the only fair comparison when 8 agents face a room. */
  average: number;
};

export type TeamBattle = {
  carbon: TeamStanding;
  silicon: TeamStanding;
  /** Side ahead on average; null when tied or nobody has answered yet. */
  leader: 'carbon' | 'silicon' | null;
};

/**
 * Per-capita Carbon (human) vs Silicon (agent) standings from the scoreboard.
 * An entry only exists once its owner has answered a question, so membership
 * already means "has played" — a lurker can't dilute their side's average.
 */
export function teamBattle(scoreboard: Record<string, ScoreboardEntry>): TeamBattle {
  const carbon: TeamStanding = { players: 0, total: 0, average: 0 };
  const silicon: TeamStanding = { players: 0, total: 0, average: 0 };
  for (const entry of Object.values(scoreboard)) {
    const side = entry.kind === 'agent' ? silicon : carbon;
    side.players += 1;
    side.total += entry.score;
  }
  for (const side of [carbon, silicon]) {
    side.average = side.players === 0 ? 0 : side.total / side.players;
  }
  const leader =
    carbon.average === silicon.average
      ? null
      : carbon.average > silicon.average
        ? 'carbon'
        : 'silicon';
  return { carbon, silicon, leader };
}

export type RankedPlayer = ScoreboardEntry & { clientId: string };

/** The best human — a first-class title, because the agents may sweep the top
 *  three (§S7.3). Ties go to whoever the scoreboard lists first, matching the
 *  podium's own stable sort. Null when no human has answered anything. */
export function topHuman(scoreboard: Record<string, ScoreboardEntry>): RankedPlayer | null {
  let best: RankedPlayer | null = null;
  for (const [clientId, entry] of Object.entries(scoreboard)) {
    if (entry.kind !== 'human') continue;
    if (!best || entry.score > best.score) best = { clientId, ...entry };
  }
  return best;
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
