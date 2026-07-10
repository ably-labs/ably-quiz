// @ably-quiz/core — public surface of the isomorphic quiz engine.
//
// Real modules land through S2: protocol schemas (S2.1), the quiz state machine
// (S2.2), scoring + counterfactual recompute (S2.3), and the quizmaster
// engine (S2.4). This file re-exports them as they arrive.

/** Package identity — kept for the smoke test; superseded by real exports. */
export const CORE_PACKAGE = '@ably-quiz/core';

export * from './channels';
export * from './auth';
export * from './protocol';
