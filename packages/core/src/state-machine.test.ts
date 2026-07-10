import { describe, expect, it } from 'vitest';
import {
  canTransition,
  initialState,
  isLastQuestion,
  transition,
  type QuizEvent,
  type QuizState,
} from './state-machine';

/** Apply a sequence of events, asserting each succeeds; returns the final state. */
function run(events: QuizEvent[], questionCount: number): QuizState {
  let state = initialState();
  for (const e of events) {
    const r = transition(state, e, questionCount);
    if (!r.ok) throw new Error(`unexpected illegal transition ${e.type} from ${state.phase}`);
    state = r.state;
  }
  return state;
}

describe('quiz state machine', () => {
  it('starts in the lobby before any question', () => {
    expect(initialState()).toEqual({ phase: 'lobby', questionIdx: -1 });
  });

  it('runs a full two-question quiz to done', () => {
    const end = run(
      [
        { type: 'next' }, // ask q0
        { type: 'lock' },
        { type: 'reveal' },
        { type: 'next' }, // ask q1
        { type: 'lock' },
        { type: 'reveal' },
        { type: 'podium' },
        { type: 'analysis' },
        { type: 'done' },
      ],
      2,
    );
    expect(end).toEqual({ phase: 'done', questionIdx: 1 });
  });

  it('advances the question index on each next', () => {
    let s = run([{ type: 'next' }], 3);
    expect(s).toEqual({ phase: 'asking', questionIdx: 0 });
    s = run([{ type: 'next' }, { type: 'lock' }, { type: 'reveal' }, { type: 'next' }], 3);
    expect(s).toEqual({ phase: 'asking', questionIdx: 1 });
  });

  it('cannot start an empty quiz', () => {
    expect(transition(initialState(), { type: 'next' }, 0)).toMatchObject({ ok: false });
  });

  it('cannot next past the last question — must go to podium', () => {
    const revealedLast = run([{ type: 'next' }, { type: 'lock' }, { type: 'reveal' }], 1);
    expect(isLastQuestion(revealedLast, 1)).toBe(true);
    expect(transition(revealedLast, { type: 'next' }, 1)).toMatchObject({ ok: false });
    expect(canTransition(revealedLast, { type: 'podium' }, 1)).toBe(true);
  });

  it('rejects illegal transitions from every phase', () => {
    const asking = run([{ type: 'next' }], 2);
    expect(transition(asking, { type: 'reveal' }, 2).ok).toBe(false); // must lock first
    const locked = run([{ type: 'next' }, { type: 'lock' }], 2);
    expect(transition(locked, { type: 'next' }, 2).ok).toBe(false); // must reveal first
    const done = run(
      [
        { type: 'next' },
        { type: 'lock' },
        { type: 'reveal' },
        { type: 'podium' },
        { type: 'analysis' },
        { type: 'done' },
      ],
      1,
    );
    expect(transition(done, { type: 'next' }, 1).ok).toBe(false); // terminal
  });

  it('lock can be driven by host or timer (same event) but only from asking', () => {
    const asking = run([{ type: 'next' }], 2);
    expect(canTransition(asking, { type: 'lock' }, 2)).toBe(true);
    const lobby = initialState();
    expect(canTransition(lobby, { type: 'lock' }, 2)).toBe(false);
  });
});
