// Quiz state machine (§B2.2). Pure: transitions happen only via explicit events
// (host commands; a timer expiry produces the same `lock` event). No timers, no
// Ably, no I/O here — just legal phase movement, so it is exhaustively testable.

import type { Phase } from './protocol';

export type QuizState = {
  phase: Phase;
  /** Current question index; -1 while in the lobby. */
  questionIdx: number;
};

export type QuizEvent =
  | { type: 'next' } // lobby → ask q0, or revealed → ask q(idx+1)
  | { type: 'lock' } // asking → locked (host button or timer expiry)
  | { type: 'reveal' } // locked → revealed (correct answer + scoring)
  | { type: 'podium' } // revealed → podium (end of quiz)
  | { type: 'analysis' } // podium → analysis (commentator + counterfactual)
  | { type: 'done' }; // analysis → done

export type TransitionResult = { ok: true; state: QuizState } | { ok: false; reason: string };

export function initialState(): QuizState {
  return { phase: 'lobby', questionIdx: -1 };
}

/**
 * Compute the next state for an event, or a reason it's illegal. `questionCount`
 * gates the question loop: you can't `next` past the last question (go to
 * `podium` instead) and can't start an empty quiz.
 */
export function transition(
  state: QuizState,
  event: QuizEvent,
  questionCount: number,
): TransitionResult {
  const idx = state.questionIdx;
  const to = (phase: Phase, questionIdx: number): TransitionResult => ({
    ok: true,
    state: { phase, questionIdx },
  });

  switch (state.phase) {
    case 'lobby':
      if (event.type === 'next') {
        if (questionCount <= 0) return { ok: false, reason: 'no questions to start' };
        return to('asking', 0);
      }
      break;
    case 'asking':
      if (event.type === 'lock') return to('locked', idx);
      break;
    case 'locked':
      if (event.type === 'reveal') return to('revealed', idx);
      break;
    case 'revealed':
      if (event.type === 'next') {
        const nextIdx = idx + 1;
        if (nextIdx >= questionCount) {
          return { ok: false, reason: 'no more questions; go to podium' };
        }
        return to('asking', nextIdx);
      }
      if (event.type === 'podium') return to('podium', idx);
      break;
    case 'podium':
      if (event.type === 'analysis') return to('analysis', idx);
      break;
    case 'analysis':
      if (event.type === 'done') return to('done', idx);
      break;
    case 'done':
      break;
  }
  return { ok: false, reason: `illegal transition: '${event.type}' from '${state.phase}'` };
}

export function canTransition(state: QuizState, event: QuizEvent, questionCount: number): boolean {
  return transition(state, event, questionCount).ok;
}

/** True when the current question is the last one (meaningful in asking/locked/revealed). */
export function isLastQuestion(state: QuizState, questionCount: number): boolean {
  return state.questionIdx === questionCount - 1;
}
