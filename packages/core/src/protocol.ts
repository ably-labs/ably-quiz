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
  // Agents attach their one-liner here; players omit it. The answers fan-in is
  // host-subscribe-only (§B2.5), so the quip can't leak to a player mid-question
  // — the host re-releases it at reveal via `agent-quips` on the main channel (S5.3).
  quip: z.string().optional(),
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
// show each agent's STATUS. Players hold read-only subscribe on this channel
// (§B2.5), so as of S5.3 it carries status ONLY — no reasoning text, no quip —
// to close the mid-question wire-leak: `thinking`/`answered` ship empty `text`
// and no `quip`; only `error` carries a short message (which can't reveal the
// answer). `text`/`quip` stay optional in the schema for back-compat, but the
// wire no longer populates them for the reasoning path.
export const agentThinkingSchema = z.object({
  slug: z.string().min(1),
  idx: z.number().int().nonnegative(),
  // `error` = the turn failed (quota/auth/etc.) — surfaced as a warning on screen.
  phase: z.enum(['thinking', 'answered', 'error']),
  text: z.string(),
  quip: z.string().optional(),
});
export type AgentThinkingMessage = z.infer<typeof agentThinkingSchema>;

// --- Reveal-time agent quips (§S5.3) ----------------------------------------
// The agents' one-liners for a question, released TOGETHER only at reveal. Agents
// carry their quip on the host-subscribe-only answers fan-in; the host gathers
// them per idx and re-publishes this batch on the main channel at reveal, so
// /screen can show the "takes" without ever putting an answer-revealing quip on a
// player-readable channel while the question is open.
export const agentQuipsSchema = z.object({
  idx: z.number().int().nonnegative(),
  quips: z.array(z.object({ slug: z.string().min(1), quip: z.string() })),
});
export type AgentQuips = z.infer<typeof agentQuipsSchema>;

// --- Agent transcript — "view the conversation" (§S6.6) ---------------------
// A full record of ONE agent's turn on ONE question: the prompt it saw, its
// think-aloud, any MCP tool calls it made (with truncated input/result), timing,
// and its answer. Captured server-side in the agent turn, carried on the
// host-subscribe-only answers fan-in, and released by the host at reveal on the
// main channel — exactly like quips — so reasoning that could reveal an answer
// never reaches a player-readable channel while the question is open. The
// end-of-quiz conversation viewer reads these from main-channel history.
export const agentToolCallSchema = z.object({
  name: z.string().min(1),
  /** The MCP server that served the tool (Anthropic `server_name`). */
  server: z.string().optional(),
  /** Truncated JSON of the tool input, and truncated text of its result. */
  input: z.string().optional(),
  result: z.string().optional(),
  isError: z.boolean().optional(),
  /** How long the call itself took, in ms. */
  ms: z.number().optional(),
});
export type AgentToolCall = z.infer<typeof agentToolCallSchema>;

export const agentTranscriptSchema = z.object({
  slug: z.string().min(1),
  idx: z.number().int().nonnegative(),
  model: z.string().min(1),
  provider: z.string().min(1),
  /** Whether MCP grounding was actually active for this turn. */
  grounded: z.boolean(),
  question: z.string(),
  options: z.array(z.string()),
  /** The visible think-aloud (reasoning before the answer JSON). */
  reasoning: z.string(),
  toolCalls: z.array(agentToolCallSchema),
  choice: choiceSchema.nullable(),
  confidence: z.number().min(0).max(1).optional(),
  quip: z.string().optional(),
  /** Filled by the host at reveal (it alone knows the correct letter). */
  correct: z.boolean().optional(),
  ttftMs: z.number().nullable().optional(),
  answerMs: z.number().nullable().optional(),
  totalMs: z.number().nullable().optional(),
  timedOut: z.boolean().optional(),
  forcedGuess: z.boolean().optional(),
  /** Ably server timestamp when the host received the turn on the fan-in. */
  receivedAt: z.number().optional(),
});
export type AgentTranscript = z.infer<typeof agentTranscriptSchema>;

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

export function parseAgentQuips(data: unknown): AgentQuips | null {
  const result = agentQuipsSchema.safeParse(data);
  return result.success ? result.data : null;
}

export function parseAgentTranscript(data: unknown): AgentTranscript | null {
  const result = agentTranscriptSchema.safeParse(data);
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

// --- Counterfactual "by the way…" panel (§B2.6 / S5.1) ----------------------
// Published once by the host on the main channel when the quiz reaches
// `analysis`: the final standings recomputed under EVERY scoring algorithm,
// name/kind-resolved and trimmed to the top few, so /screen · /play · host can
// show "under fastest-finger the winner would've been Priya, not Matt". Pure
// recompute over the persisted answer log — no extra infra.
export const counterfactualStandingSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().min(1),
  kind: kindSchema,
  score: z.number(),
});
export type CounterfactualStanding = z.infer<typeof counterfactualStandingSchema>;

export const counterfactualPayloadSchema = z.object({
  /** The algorithm the quiz was actually scored under (its row is "scored live"). */
  activeAlgoId: z.string(),
  algos: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      blurb: z.string(),
      top: z.array(counterfactualStandingSchema),
    }),
  ),
});
export type CounterfactualPayload = z.infer<typeof counterfactualPayloadSchema>;

export function parseCounterfactual(data: unknown): CounterfactualPayload | null {
  const result = counterfactualPayloadSchema.safeParse(data);
  return result.success ? result.data : null;
}
