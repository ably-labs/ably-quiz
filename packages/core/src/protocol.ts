// Protocol — the single source of truth for every message and LiveObjects shape
// on the wire (§B2). zod schemas + inferred TS types so runtime validation and
// compile-time types can never drift.

import { z } from 'zod';

// --- Primitives -------------------------------------------------------------
export const choiceSchema = z.enum(['A', 'B', 'C', 'D']);
export type Choice = z.infer<typeof choiceSchema>;

/** Quiz lifecycle phases (§B2.3). */
export const phaseSchema = z.enum([
  'lobby',
  'asking',
  'locked',
  'revealed',
  'podium',
  'analysis',
  'done',
]);
export type Phase = z.infer<typeof phaseSchema>;

/** Species — matches the auth `Kind`; derived from the clientId prefix. */
export const kindSchema = z.enum(['human', 'agent']);

// --- Question definitions ---------------------------------------------------
// Host-side full quiz. Options are shuffled ONCE server-side at broadcast
// (§B2.8); the correct answer is withheld from the broadcast entirely.
export const questionDefSchema = z.object({
  prompt: z.string().min(1),
  options: z.array(z.string().min(1)).min(2).max(4),
  correctIndex: z.number().int().nonnegative(),
  limitMs: z.number().int().positive(),
  category: z.string().min(1).optional(),
});
export type QuestionDef = z.infer<typeof questionDefSchema>;

// --- Control messages (host → all, on the main channel) ---------------------
// Transient events that drive timing and UI; durable state also lives in
// LiveObjects. The `question` message's Ably server timestamp is T₀ (§B2.2).
export const controlMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('question'),
    idx: z.number().int().nonnegative(),
    prompt: z.string().min(1),
    // Shuffled options in display order; index 0 → 'A', 1 → 'B', … The correct
    // option is NOT included — players and agents must not see it.
    options: z.array(z.string().min(1)).min(2).max(4),
    limitMs: z.number().int().positive(),
    category: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal('lock'), idx: z.number().int().nonnegative() }),
  z.object({
    type: z.literal('reveal'),
    idx: z.number().int().nonnegative(),
    correct: choiceSchema,
  }),
  z.object({ type: z.literal('podium') }),
  z.object({ type: z.literal('analysis') }),
  z.object({ type: z.literal('done') }),
]);
export type ControlMessage = z.infer<typeof controlMessageSchema>;

// --- Answer message (players & agents → fan-in channel) ---------------------
// The clientId comes from the (auth-controlled) Ably envelope, and elapsedMs is
// computed by the quizmaster from server timestamps — neither is trusted from
// the payload.
export const answerMessageSchema = z.object({
  idx: z.number().int().nonnegative(),
  choice: choiceSchema,
  confidence: z.number().min(0).max(1).optional(),
});
export type AnswerMessage = z.infer<typeof answerMessageSchema>;

// --- LiveObjects shapes (§B2.3) ---------------------------------------------
export const quizConfigSchema = z.object({
  scoringAlgoId: z.string().min(1),
  questionCount: z.number().int().nonnegative(),
  defaultLimitMs: z.number().int().positive(),
  streakEnabled: z.boolean(),
  /** Host auto-reveals the answer once a question resolves (everyone answered or
   *  time's up). Optional; the host treats `undefined` as `true`. Turn off to
   *  hold on the locked screen and reveal manually for suspense. */
  autoReveal: z.boolean().optional(),
});
export type QuizConfig = z.infer<typeof quizConfigSchema>;

/** Per-option answer counts for the current question (LiveCounter-backed). */
export const talliesSchema = z.object({
  A: z.number().int().nonnegative(),
  B: z.number().int().nonnegative(),
  C: z.number().int().nonnegative(),
  D: z.number().int().nonnegative(),
});
export type Tallies = z.infer<typeof talliesSchema>;

/** One entry in the scoreboard LiveMap, keyed by clientId. */
export const scoreboardEntrySchema = z.object({
  name: z.string().min(1),
  kind: kindSchema,
  score: z.number(),
  streak: z.number().int().nonnegative(),
  answered: z.boolean(),
});
export type ScoreboardEntry = z.infer<typeof scoreboardEntrySchema>;

// --- Answer log (scoring authority + counterfactual, §B2.6) -----------------
export const answerLogEntrySchema = z.object({
  clientId: z.string().min(1),
  idx: z.number().int().nonnegative(),
  choice: choiceSchema,
  correct: z.boolean(),
  elapsedMs: z.number().int().nonnegative(),
});
export type AnswerLogEntry = z.infer<typeof answerLogEntrySchema>;

// --- Safe parse helpers (used by the quizmaster on untrusted inbound data) --
export function parseAnswerMessage(data: unknown): AnswerMessage | null {
  const result = answerMessageSchema.safeParse(data);
  return result.success ? result.data : null;
}

export function parseControlMessage(data: unknown): ControlMessage | null {
  const result = controlMessageSchema.safeParse(data);
  return result.success ? result.data : null;
}
