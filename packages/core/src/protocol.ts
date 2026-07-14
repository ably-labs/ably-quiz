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

// --- Agent roster (§S4.4 on-demand) -----------------------------------------
// The set of agents chosen to play, declared at CREATE time. Display fields are
// copied from each agent's manifest so the roster renders without the runner
// running: an agent is "present" because it's declared, and is invoked
// per-question (a request-based turn) rather than as a persistent process.
export const agentRosterEntrySchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  emoji: z.string().min(1),
  owner: z.string().min(1),
  model: z.string().min(1),
});
export type AgentRosterEntry = z.infer<typeof agentRosterEntrySchema>;

// --- Agent thinking (§S4.5 on-screen thinking) ------------------------------
// Published to quiz-agent:{id}:{slug} during an on-demand turn so /screen can
// show each agent's live think-aloud + status. Ephemeral, scoped to a question
// idx: `phase:'thinking'` carries the accumulating think-aloud (throttled), and
// a final `phase:'answered'` carries the settled reasoning + quip.
export const agentThinkingSchema = z.object({
  slug: z.string().min(1),
  idx: z.number().int().nonnegative(),
  // `error` = the turn failed (quota/auth/etc.) — surfaced as a warning on screen.
  phase: z.enum(['thinking', 'answered', 'error']),
  text: z.string(),
  quip: z.string().optional(),
});
export type AgentThinkingMessage = z.infer<typeof agentThinkingSchema>;

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
  /** Agents declared to play, chosen at create time (§S4.4). Published in config
   *  so /host and /screen render the roster; the host invokes each per question. */
  agents: z.array(agentRosterEntrySchema).optional(),
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

export function parseAgentThinking(data: unknown): AgentThinkingMessage | null {
  const result = agentThinkingSchema.safeParse(data);
  return result.success ? result.data : null;
}

// --- Commentator (§B2.9) ----------------------------------------------------
// The analysis-phase breakdown, streamed token-by-token onto /screen. Published
// (throttled) to quiz-agent:{id}:commentator; `done` marks the final message.
export const commentaryMessageSchema = z.object({
  text: z.string(),
  done: z.boolean(),
});
export type CommentaryMessage = z.infer<typeof commentaryMessageSchema>;

export function parseCommentary(data: unknown): CommentaryMessage | null {
  const result = commentaryMessageSchema.safeParse(data);
  return result.success ? result.data : null;
}
