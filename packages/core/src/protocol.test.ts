import { describe, expect, it } from 'vitest';
import {
  answerMessageSchema,
  controlMessageSchema,
  parseAnswerMessage,
  parseControlMessage,
  questionDefSchema,
  scoreboardEntrySchema,
} from './protocol';

describe('answer message', () => {
  it('accepts a valid answer and an optional confidence', () => {
    expect(answerMessageSchema.safeParse({ idx: 0, choice: 'B' }).success).toBe(true);
    expect(answerMessageSchema.safeParse({ idx: 3, choice: 'A', confidence: 0.9 }).success).toBe(
      true,
    );
  });

  it('rejects bad choices, negative idx, and out-of-range confidence', () => {
    expect(answerMessageSchema.safeParse({ idx: 0, choice: 'E' }).success).toBe(false);
    expect(answerMessageSchema.safeParse({ idx: -1, choice: 'A' }).success).toBe(false);
    expect(answerMessageSchema.safeParse({ idx: 0, choice: 'A', confidence: 2 }).success).toBe(
      false,
    );
  });

  it('parseAnswerMessage returns typed data or null', () => {
    expect(parseAnswerMessage({ idx: 1, choice: 'C' })).toEqual({ idx: 1, choice: 'C' });
    expect(parseAnswerMessage('nope')).toBeNull();
    expect(parseAnswerMessage({ idx: 1 })).toBeNull();
  });
});

describe('control message (discriminated union)', () => {
  it('accepts each control type', () => {
    expect(
      controlMessageSchema.safeParse({
        type: 'question',
        idx: 0,
        prompt: 'Q?',
        options: ['a', 'b', 'c', 'd'],
        limitMs: 20000,
      }).success,
    ).toBe(true);
    expect(controlMessageSchema.safeParse({ type: 'lock', idx: 0 }).success).toBe(true);
    expect(controlMessageSchema.safeParse({ type: 'reveal', idx: 0, correct: 'A' }).success).toBe(
      true,
    );
    expect(controlMessageSchema.safeParse({ type: 'podium' }).success).toBe(true);
    expect(controlMessageSchema.safeParse({ type: 'done' }).success).toBe(true);
  });

  it('rejects a question with the wrong shape or unknown type', () => {
    // only 1 option
    expect(
      controlMessageSchema.safeParse({
        type: 'question',
        idx: 0,
        prompt: 'Q',
        options: ['a'],
        limitMs: 1,
      }).success,
    ).toBe(false);
    expect(parseControlMessage({ type: 'nope' })).toBeNull();
  });

  it('a broadcast question never carries the correct answer', () => {
    const msg = parseControlMessage({
      type: 'question',
      idx: 0,
      prompt: 'Q?',
      options: ['a', 'b'],
      limitMs: 20000,
    });
    expect(msg).not.toBeNull();
    expect(msg && 'correct' in msg).toBe(false);
  });
});

describe('question definition', () => {
  it('requires 2–4 options and a correct index', () => {
    expect(
      questionDefSchema.safeParse({
        prompt: 'Q?',
        options: ['x', 'y', 'z'],
        correctIndex: 1,
        limitMs: 20000,
      }).success,
    ).toBe(true);
    expect(
      questionDefSchema.safeParse({ prompt: 'Q?', options: ['only'], correctIndex: 0, limitMs: 1 })
        .success,
    ).toBe(false);
  });
});

describe('scoreboard entry', () => {
  it('validates species and score shape', () => {
    expect(
      scoreboardEntrySchema.safeParse({
        name: 'Priya',
        kind: 'human',
        score: 1200,
        streak: 3,
        answered: true,
      }).success,
    ).toBe(true);
    expect(
      scoreboardEntrySchema.safeParse({
        name: 'Matt Fable',
        kind: 'robot',
        score: 0,
        streak: 0,
        answered: false,
      }).success,
    ).toBe(false);
  });
});
