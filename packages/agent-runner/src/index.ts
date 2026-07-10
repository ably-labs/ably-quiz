// @ably-quiz/agent-runner — the default agent runner and registry loader.
//
// Real implementation lands in S4: registry loader (S4.1), AIT session
// lifecycle + streamed thinking (S4.2), deadline budget + supervisor. Reuses
// the streaming/JSON approach proven in the S0 spike.

import { CORE_PACKAGE } from '@ably-quiz/core';

/** Package identity — replaced by real exports in S4. */
export const AGENT_RUNNER_PACKAGE = '@ably-quiz/agent-runner';

/** Smoke reference so the workspace link to core is exercised. */
export const DEPENDS_ON = CORE_PACKAGE;
