// Channel & namespace naming (see docs/ABLY-SETUP.md).
//
// Ably namespaces are the channel-name segment before the FIRST colon, so the
// three roles use distinct prefixes to carry different channel rules (batching
// on answers, appends on agent sessions, neither on the main channel).

export const NAMESPACE = {
  /** control events, lobby presence, LiveObjects */
  main: 'quiz',
  /** fan-in answers (batched; only the quizmaster subscribes) */
  answers: 'quiz-answers',
  /** one AI Transport session per agent (message appends enabled) */
  agent: 'quiz-agent',
} as const;

/** `quiz:{id}` — control, presence, LiveObjects root. */
export function mainChannel(quizId: string): string {
  return `${NAMESPACE.main}:${quizId}`;
}

/** `quiz-answers:{id}` — everyone publishes answers; only the quizmaster subscribes. */
export function answersChannel(quizId: string): string {
  return `${NAMESPACE.answers}:${quizId}`;
}

/** `quiz-agent:{id}:{slug}` — one agent's public AIT session. */
export function agentChannel(quizId: string, slug: string): string {
  return `${NAMESPACE.agent}:${quizId}:${slug}`;
}

/** `quiz-agent:{id}:*` — capability pattern covering all of a quiz's agent sessions. */
export function agentChannelPattern(quizId: string): string {
  return `${NAMESPACE.agent}:${quizId}:*`;
}
