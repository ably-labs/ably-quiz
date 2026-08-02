// The quizmaster — scoring authority and question-loop driver (§B2.4).
//
// Isomorphic and I/O-free: it depends on a `Broadcaster` (publish control, get
// the server timestamp) and a `QuizStore` (LiveObjects writes), both injected,
// and answers are pushed in via `ingest()`. So the whole engine runs unchanged
// in the host browser or under Node, and is fully testable against mocks.
//
// It holds the correct answers (never broadcast), computes elapsed from Ably
// server timestamps, enforces first-answer-wins + the window, scores each answer
// live, keeps the raw answer log, and can rebuild its entire state from channel
// history (recovery, §B2.3).
//
// ⚠️ Fairness — what may reach the wire WHILE a question is open (§S7.1). The
// LiveObjects state this engine writes is player-readable, so anything derived
// from a choice or its correctness is withheld until the question closes:
//   · per-option tallies  → buffered in memory, flushed to the store at `lock`
//   · score + streak      → published totals lag the live ones until `reveal`
// Only the boolean `answered` flag moves during `asking` — it carries no choice
// information and drives the "X of Y answered" readout. Without this, the early
// tally distribution (agents answer in 2–12s) told the room what to copy.

import { kindFromClientId } from './auth';
import {
  parseAnswerMessage,
  type AnswerLogEntry,
  type Choice,
  type ControlMessage,
  type CounterfactualPayload,
  type Phase,
  type QuestionDef,
  type QuizConfig,
  type ScoreboardEntry,
} from './protocol';
import {
  counterfactual,
  getAlgo,
  GRACE_MS,
  listAlgos,
  recomputeStandings,
  scoreQuestion,
  type Standing,
} from './scoring';
import { initialState, transition, type QuizEvent, type QuizState } from './state-machine';

const LETTERS = ['A', 'B', 'C', 'D'] as const satisfies readonly Choice[];

export type InboundAnswer = { clientId: string; data: unknown; serverTs: number };
export type ControlHistoryEntry = { msg: ControlMessage; serverTs: number };

export interface Broadcaster {
  /** Publish a control message on the main channel; resolve with its authoritative Ably server timestamp. */
  publishControl(msg: ControlMessage): Promise<number>;
}

export interface QuizStore {
  setConfig(config: QuizConfig): void;
  setPhase(phase: Phase, questionIdx: number): void;
  resetTally(): void;
  setTally(choice: Choice, count: number): void;
  setScoreboardEntry(clientId: string, entry: ScoreboardEntry): void;
}

export type QuizmasterDeps = {
  quizId: string;
  questions: QuestionDef[];
  config: QuizConfig;
  broadcaster: Broadcaster;
  store: QuizStore;
  /** Returns a permutation of [0..n-1] for shuffling options (§B2.8). Injectable for tests. */
  permute?: (n: number) => number[];
};

function fisherYates(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export class Quizmaster {
  private readonly deps: QuizmasterDeps;
  private readonly permute: (n: number) => number[];

  private sm: QuizState = initialState();
  private readonly t0ByIdx = new Map<number, number>();
  private readonly correctByIdx = new Map<number, Choice>();
  private readonly answeredKeys = new Set<string>(); // `${clientId}#${idx}` — first-answer-wins
  private readonly scores = new Map<string, number>();
  private readonly streaks = new Map<string, number>();
  // What the WIRE currently says (§S7.1). Live scoring runs ahead of these; they
  // only catch up at `reveal`, so a mid-question score jump can never tell the
  // room that a given player or agent just answered correctly.
  private readonly publishedScores = new Map<string, number>();
  private readonly publishedStreaks = new Map<string, number>();
  private readonly names = new Map<string, string>();
  private readonly log: AnswerLogEntry[] = [];
  private tally: Record<Choice, number> = { A: 0, B: 0, C: 0, D: 0 };
  /** True once this question's tallies may be written to the store (from `lock`). */
  private talliesReleased = false;
  private answeredThisQuestion = new Set<string>();
  // Answers that arrive before T₀ is captured (the publish-echo hasn't returned
  // yet) are held here per question and scored the moment T₀ lands — so a fast
  // answer is never dropped by that race.
  private readonly pendingByIdx = new Map<
    number,
    { clientId: string; choice: Choice; serverTs: number; live: boolean }[]
  >();

  constructor(deps: QuizmasterDeps) {
    this.deps = deps;
    this.permute = deps.permute ?? fisherYates;
  }

  /** Publish initial config + lobby phase (fresh quiz). */
  init(): void {
    this.deps.store.setConfig(this.deps.config);
    this.deps.store.setPhase('lobby', -1);
  }

  getState(): QuizState {
    return { ...this.sm };
  }

  /** The correct letter for a question once it's been asked — host UI only
   *  (the host knows the answers; this is never broadcast to contestants). */
  getCorrect(idx: number): Choice | undefined {
    return this.correctByIdx.get(idx);
  }

  /** Record a display name (from lobby presence) for scoreboard entries. If the
   *  name actually changes for a client that already has a published scoreboard
   *  entry, heal that entry — a host recover/HMR rebuild can score an answer
   *  (publishing an entry named by the raw clientId, e.g. "p:wy6ca4n0") before
   *  presence has reported that player's chosen nickname; without this re-write
   *  the stale raw id would stick on the board (§S5.2). */
  setDisplayName(clientId: string, name: string): void {
    const prev = this.names.get(clientId);
    this.names.set(clientId, name);
    if (name !== prev && this.scores.has(clientId)) this.writeScoreboardEntry(clientId);
  }

  // --- Host-driven question loop -------------------------------------------
  /** Advance to the next question: shuffle options once, broadcast, capture T₀. */
  async askNext(): Promise<void> {
    this.applyEvent({ type: 'next' });
    const idx = this.sm.questionIdx;
    const q = this.requireQuestion(idx);

    const perm = this.permute(q.options.length);
    const options = perm.map((i) => q.options[i]!);
    const correctPos = perm.indexOf(q.correctIndex);
    this.correctByIdx.set(idx, LETTERS[correctPos]!);

    this.resetQuestionState();
    const serverTs = await this.deps.broadcaster.publishControl({
      type: 'question',
      idx,
      prompt: q.prompt,
      options,
      limitMs: q.limitMs,
      ...(q.category ? { category: q.category } : {}),
      ...(q.author ? { author: q.author } : {}),
    });
    this.t0ByIdx.set(idx, serverTs);
    this.deps.store.setPhase('asking', idx);

    // Score any answers that raced ahead of T₀.
    const buffered = this.pendingByIdx.get(idx);
    if (buffered) {
      this.pendingByIdx.delete(idx);
      for (const b of buffered) this.scoreRecorded(b.clientId, idx, b.choice, b.serverTs, b.live);
    }
  }

  async lock(): Promise<void> {
    this.applyEvent({ type: 'lock' });
    await this.deps.broadcaster.publishControl({ type: 'lock', idx: this.sm.questionIdx });
    this.deps.store.setPhase('locked', this.sm.questionIdx);
    this.flushTallies(); // answers are closed — the distribution is safe now (§S7.1)
  }

  async reveal(): Promise<void> {
    this.applyEvent({ type: 'reveal' });
    const idx = this.sm.questionIdx;
    const correct = this.correctByIdx.get(idx);
    if (!correct) throw new Error(`no correct answer known for question ${idx}`);
    await this.deps.broadcaster.publishControl({ type: 'reveal', idx, correct });
    this.deps.store.setPhase('revealed', idx);
    this.releaseScores(); // the answer is out — scores/streaks may move (§S7.1)
  }

  async podium(): Promise<void> {
    this.applyEvent({ type: 'podium' });
    await this.deps.broadcaster.publishControl({ type: 'podium' });
    this.deps.store.setPhase('podium', this.sm.questionIdx);
  }

  async analysis(): Promise<void> {
    this.applyEvent({ type: 'analysis' });
    await this.deps.broadcaster.publishControl({ type: 'analysis' });
    this.deps.store.setPhase('analysis', this.sm.questionIdx);
  }

  async done(): Promise<void> {
    this.applyEvent({ type: 'done' });
    await this.deps.broadcaster.publishControl({ type: 'done' });
    this.deps.store.setPhase('done', this.sm.questionIdx);
  }

  // --- Answer ingestion (live) ---------------------------------------------
  /** Handle one inbound answer. Only counts answers for the open current question. */
  ingest(a: InboundAnswer): void {
    if (this.sm.phase !== 'asking' && this.sm.phase !== 'locked') return;
    const msg = parseAnswerMessage(a.data);
    if (!msg || msg.idx !== this.sm.questionIdx) return;
    this.record(a.clientId, msg.idx, msg.choice, a.serverTs, true);
  }

  // --- Recovery (§B2.3) ----------------------------------------------------
  /** Rebuild the entire engine state from channel history after a restart. */
  recover(controlHistory: ControlHistoryEntry[], answerHistory: InboundAnswer[]): void {
    this.reset();

    // 1. Replay control to recover T₀ + correct letter per question, and phase.
    for (const { msg, serverTs } of controlHistory) {
      if (msg.type === 'question') {
        this.t0ByIdx.set(msg.idx, serverTs);
        const q = this.deps.questions[msg.idx];
        if (q) {
          const correctText = q.options[q.correctIndex];
          const pos = correctText === undefined ? -1 : msg.options.indexOf(correctText);
          if (pos >= 0) this.correctByIdx.set(msg.idx, LETTERS[pos]!);
        }
        this.sm = { phase: 'asking', questionIdx: msg.idx };
      } else if (msg.type === 'lock') {
        this.sm = { phase: 'locked', questionIdx: msg.idx };
      } else if (msg.type === 'reveal') {
        this.sm = { phase: 'revealed', questionIdx: msg.idx };
      } else {
        this.sm = { phase: msg.type, questionIdx: this.sm.questionIdx };
      }
    }

    // 2. Replay answers in (question, arrival) order so streaks fold correctly.
    const ordered = [...answerHistory].sort((x, y) => {
      const mx = parseAnswerMessage(x.data);
      const my = parseAnswerMessage(y.data);
      const ix = mx?.idx ?? Number.MAX_SAFE_INTEGER;
      const iy = my?.idx ?? Number.MAX_SAFE_INTEGER;
      return ix - iy || x.serverTs - y.serverTs;
    });
    // A question still in flight hasn't been revealed, so its points must not be
    // republished (§S7.1). Snapshot the published totals at that boundary — the
    // replay is idx-ordered, so everything before it is already revealed.
    const inFlight = this.sm.phase === 'asking' || this.sm.phase === 'locked';
    const releaseThrough = inFlight ? this.sm.questionIdx - 1 : Number.MAX_SAFE_INTEGER;
    let snapshotted = false;
    for (const a of ordered) {
      const msg = parseAnswerMessage(a.data);
      if (!msg) continue;
      if (!snapshotted && msg.idx > releaseThrough) {
        this.snapshotPublished();
        snapshotted = true;
      }
      this.record(a.clientId, msg.idx, msg.choice, a.serverTs, false);
    }
    if (!snapshotted) this.snapshotPublished();

    // 3. Rebuild the current-question tally + republish state to the store.
    this.deps.store.setConfig(this.deps.config);
    this.deps.store.setPhase(this.sm.phase, this.sm.questionIdx);
    this.rebuildCurrentTally();
    for (const clientId of this.scores.keys()) this.writeScoreboardEntry(clientId);
  }

  // --- Readouts ------------------------------------------------------------
  getAnswerLog(): AnswerLogEntry[] {
    return this.log.map((e) => ({ ...e }));
  }

  getStandings(): Standing[] {
    return recomputeStandings(
      this.log,
      this.limitOf,
      this.deps.config.scoringAlgoId,
      this.deps.config.streakEnabled,
    );
  }

  /** Ranked standings under every algorithm — the analysis payload (§B2.6). */
  getCounterfactual(): Record<string, Standing[]> {
    return counterfactual(this.log, this.limitOf, this.deps.config.streakEnabled);
  }

  /**
   * The "by the way…" payload (§S5.1): counterfactual standings under every
   * algorithm, name/kind-resolved and trimmed to the top `topN`. The host
   * publishes this at `analysis` so /screen · /play · host can show how the
   * podium would shift under different scoring rules.
   */
  buildCounterfactual(topN = 3): CounterfactualPayload {
    const cf = counterfactual(this.log, this.limitOf, this.deps.config.streakEnabled);
    const algos = listAlgos().map(({ id, label, blurb }) => ({
      id,
      label,
      blurb,
      top: (cf[id] ?? []).slice(0, topN).map((s) => ({
        clientId: s.clientId,
        name: this.names.get(s.clientId) ?? s.clientId,
        kind: kindFromClientId(s.clientId),
        score: s.score,
      })),
    }));
    return { activeAlgoId: this.deps.config.scoringAlgoId, algos };
  }

  // --- internals -----------------------------------------------------------
  private readonly limitOf = (idx: number): number =>
    this.deps.questions[idx]?.limitMs ?? this.deps.config.defaultLimitMs;

  private applyEvent(event: QuizEvent): void {
    const result = transition(this.sm, event, this.deps.questions.length);
    if (!result.ok) throw new Error(result.reason);
    this.sm = result.state;
  }

  private requireQuestion(idx: number): QuestionDef {
    const q = this.deps.questions[idx];
    if (!q) throw new Error(`no question at index ${idx}`);
    return q;
  }

  /**
   * Core scoring path shared by live ingest and recovery replay: dedupe
   * first-answer-wins, compute elapsed from server timestamps, enforce the
   * window, fold streak, score, append to the log, and update the store.
   */
  private record(
    clientId: string,
    idx: number,
    choice: Choice,
    serverTs: number,
    live: boolean,
  ): void {
    const key = `${clientId}#${idx}`;
    if (this.answeredKeys.has(key)) return; // first answer per client per question
    // We must know the question (correct letter) to score it at all.
    if (this.correctByIdx.get(idx) === undefined) return;
    this.answeredKeys.add(key); // first-answer-wins is locked in now, even if buffered

    if (this.t0ByIdx.get(idx) === undefined) {
      // T₀ not captured yet (publish-echo in flight) — buffer; askNext flushes it.
      const list = this.pendingByIdx.get(idx) ?? [];
      list.push({ clientId, choice, serverTs, live });
      this.pendingByIdx.set(idx, list);
      return;
    }
    this.scoreRecorded(clientId, idx, choice, serverTs, live);
  }

  /** Score one already-deduped answer (T₀ + correct letter known). */
  private scoreRecorded(
    clientId: string,
    idx: number,
    choice: Choice,
    serverTs: number,
    live: boolean,
  ): void {
    const t0 = this.t0ByIdx.get(idx)!;
    const correctLetter = this.correctByIdx.get(idx)!;
    const limitMs = this.limitOf(idx);
    const elapsedMs = Math.max(0, serverTs - t0);
    const correct = choice === correctLetter;
    const inWindow = correct && elapsedMs <= limitMs + GRACE_MS;
    const streak = inWindow ? (this.streaks.get(clientId) ?? 0) + 1 : 0;
    this.streaks.set(clientId, streak);

    const algo = getAlgo(this.deps.config.scoringAlgoId);
    if (!algo) throw new Error(`unknown scoring algo: ${this.deps.config.scoringAlgoId}`);
    const points = scoreQuestion(
      algo,
      { correct, elapsedMs, limitMs, streak },
      this.deps.config.streakEnabled,
    );
    this.scores.set(clientId, (this.scores.get(clientId) ?? 0) + points);

    this.log.push({ clientId, idx, choice, correct, elapsedMs });

    // Live tally + scoreboard updates (recovery rebuilds these in bulk afterwards).
    // The tally only reaches the store once the question has locked, and the entry
    // carries the PUBLISHED score/streak — mid-question, all it says is "answered".
    if (live) {
      this.tally[choice] += 1;
      if (this.talliesReleased) this.deps.store.setTally(choice, this.tally[choice]);
      this.answeredThisQuestion.add(clientId);
      this.writeScoreboardEntry(clientId);
    }
  }

  private writeScoreboardEntry(clientId: string): void {
    this.deps.store.setScoreboardEntry(clientId, {
      name: this.names.get(clientId) ?? clientId,
      kind: kindFromClientId(clientId),
      score: this.publishedScores.get(clientId) ?? 0,
      streak: this.publishedStreaks.get(clientId) ?? 0,
      answered: this.answeredThisQuestion.has(clientId),
    });
  }

  /** Push the buffered per-option counts to the store (§S7.1, at `lock`). */
  private flushTallies(): void {
    this.talliesReleased = true;
    for (const choice of LETTERS) this.deps.store.setTally(choice, this.tally[choice]);
  }

  /** Catch the published scores/streaks up to the live ones and re-publish every
   *  entry that moved (§S7.1, at `reveal`). */
  private releaseScores(): void {
    this.snapshotPublished((clientId) => this.writeScoreboardEntry(clientId));
  }

  /** Copy live scores/streaks into the published view, calling `onChange` for each
   *  client whose wire-visible numbers actually moved. */
  private snapshotPublished(onChange?: (clientId: string) => void): void {
    for (const clientId of this.scores.keys()) {
      const score = this.scores.get(clientId) ?? 0;
      const streak = this.streaks.get(clientId) ?? 0;
      if (
        (this.publishedScores.get(clientId) ?? 0) === score &&
        (this.publishedStreaks.get(clientId) ?? 0) === streak
      ) {
        continue;
      }
      this.publishedScores.set(clientId, score);
      this.publishedStreaks.set(clientId, streak);
      onChange?.(clientId);
    }
  }

  private resetQuestionState(): void {
    // Clear the previous question's "answered" flags for anyone who answered.
    const previouslyAnswered = this.answeredThisQuestion;
    this.answeredThisQuestion = new Set();
    for (const clientId of previouslyAnswered) this.writeScoreboardEntry(clientId);
    this.tally = { A: 0, B: 0, C: 0, D: 0 };
    this.talliesReleased = false; // buffered again until this question locks (§S7.1)
    this.deps.store.resetTally();
  }

  private rebuildCurrentTally(): void {
    this.tally = { A: 0, B: 0, C: 0, D: 0 };
    this.deps.store.resetTally();
    for (const e of this.log) {
      if (e.idx === this.sm.questionIdx) {
        this.tally[e.choice] += 1;
        this.answeredThisQuestion.add(e.clientId);
      }
    }
    // A recovering host must not publish the counts of a question that's still
    // open — a late joiner correctly reads zeroes mid-`asking` (§S7.1).
    this.talliesReleased = this.sm.phase !== 'asking';
    if (this.talliesReleased) {
      for (const choice of LETTERS) this.deps.store.setTally(choice, this.tally[choice]);
    }
  }

  private reset(): void {
    this.sm = initialState();
    this.t0ByIdx.clear();
    this.correctByIdx.clear();
    this.answeredKeys.clear();
    this.pendingByIdx.clear();
    this.scores.clear();
    this.streaks.clear();
    this.publishedScores.clear();
    this.publishedStreaks.clear();
    this.log.length = 0;
    this.tally = { A: 0, B: 0, C: 0, D: 0 };
    this.talliesReleased = false;
    this.answeredThisQuestion = new Set();
  }
}
