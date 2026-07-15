import { describe, expect, it } from 'vitest';
import {
  answerMessageSchema,
  controlMessageSchema,
  parseAgentQuips,
  parseAgentThinking,
  parseAgentTranscript,
  parseCommentary,
  parseAnswerMessage,
  parseControlMessage,
  questionDefSchema,
  quizConfigSchema,
  scoreboardEntrySchema,
} from './protocol';

describe('agent transcript', () => {
  const base = {
    slug: 'matt-opus',
    idx: 0,
    model: 'claude-opus-4-8',
    provider: 'anthropic',
    grounded: true,
    question: 'What does AIT stand for?',
    options: ['Ably Internal Tooling', 'AI Transport'],
    reasoning: 'The notes mention AI Transport.',
    toolCalls: [{ name: 'wikiSearchPages', input: '{"q":"AIT"}', result: 'AI Transport' }],
    choice: 'B',
  };

  it('parses a full transcript (with tool calls) and keeps optional fields', () => {
    const t = parseAgentTranscript({ ...base, correct: true, answerMs: 1200 });
    expect(t?.slug).toBe('matt-opus');
    expect(t?.toolCalls[0]?.name).toBe('wikiSearchPages');
    expect(t?.correct).toBe(true);
    expect(t?.answerMs).toBe(1200);
  });

  it('accepts a null choice (a no-answer / timed-out turn) with empty tool calls', () => {
    const t = parseAgentTranscript({ ...base, choice: null, grounded: false, toolCalls: [] });
    expect(t?.choice).toBeNull();
    expect(t?.toolCalls).toEqual([]);
  });

  it('rejects a bad choice', () => {
    expect(parseAgentTranscript({ ...base, choice: 'Z' })).toBeNull();
  });
});

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

  it('round-trips with and without an agent quip (§S5.3)', () => {
    // Player answer: no quip.
    expect(parseAnswerMessage({ idx: 2, choice: 'B' })).toEqual({ idx: 2, choice: 'B' });
    // Agent answer: carries the one-liner on the host-only fan-in.
    expect(
      parseAnswerMessage({ idx: 2, choice: 'B', confidence: 0.8, quip: 'Elementary.' }),
    ).toEqual({ idx: 2, choice: 'B', confidence: 0.8, quip: 'Elementary.' });
    // A non-string quip is rejected (can't be smuggled through).
    expect(answerMessageSchema.safeParse({ idx: 2, choice: 'B', quip: 42 }).success).toBe(false);
  });
});

describe('agent quips message (§S5.3)', () => {
  it('parses a valid reveal-time quips batch', () => {
    expect(
      parseAgentQuips({
        idx: 3,
        quips: [
          { slug: 'matt-opus', quip: 'Too easy.' },
          { slug: 'matt-grok', quip: 'Called it.' },
        ],
      }),
    ).toEqual({
      idx: 3,
      quips: [
        { slug: 'matt-opus', quip: 'Too easy.' },
        { slug: 'matt-grok', quip: 'Called it.' },
      ],
    });
    // An empty batch is still structurally valid (host only publishes non-empty ones).
    expect(parseAgentQuips({ idx: 0, quips: [] })).toEqual({ idx: 0, quips: [] });
  });

  it('rejects a negative idx, a missing slug, or a non-array', () => {
    expect(parseAgentQuips({ idx: -1, quips: [] })).toBeNull();
    expect(parseAgentQuips({ idx: 0, quips: [{ quip: 'no slug' }] })).toBeNull();
    expect(parseAgentQuips({ idx: 0, quips: 'nope' })).toBeNull();
    expect(parseAgentQuips('nope')).toBeNull();
  });
});

describe('agent thinking message (§S4.5)', () => {
  it('parses a thinking-phase and an answered-phase message', () => {
    expect(
      parseAgentThinking({ slug: 'matt-grok', idx: 0, phase: 'thinking', text: 'Gold is Au…' }),
    ).toEqual({ slug: 'matt-grok', idx: 0, phase: 'thinking', text: 'Gold is Au…' });
    expect(
      parseAgentThinking({ slug: 'matt-grok', idx: 0, phase: 'answered', text: '', quip: 'Easy.' }),
    ).toMatchObject({ phase: 'answered', quip: 'Easy.' });
    expect(
      parseAgentThinking({ slug: 'matt-gpt', idx: 1, phase: 'error', text: '429 quota' }),
    ).toMatchObject({ phase: 'error' });
  });

  it('rejects an unknown phase or missing fields', () => {
    expect(parseAgentThinking({ slug: 'x', idx: 0, phase: 'done', text: '' })).toBeNull();
    expect(parseAgentThinking({ slug: 'x', phase: 'thinking', text: '' })).toBeNull();
    expect(parseAgentThinking('nope')).toBeNull();
  });
});

describe('commentary message (§B2.9)', () => {
  it('parses streaming and final commentary, rejects malformed', () => {
    expect(parseCommentary({ text: 'And they', done: false })).toEqual({
      text: 'And they',
      done: false,
    });
    expect(parseCommentary({ text: 'Silicon takes it!', done: true })).toMatchObject({
      done: true,
    });
    expect(parseCommentary({ text: 'no done flag' })).toBeNull();
    expect(parseCommentary('nope')).toBeNull();
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

describe('quiz config', () => {
  const base = {
    scoringAlgoId: 'classic',
    questionCount: 5,
    defaultLimitMs: 20000,
    streakEnabled: false,
  };

  it('accepts a config without an agent roster (declared roster is optional)', () => {
    expect(quizConfigSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a declared agent roster and rejects a malformed entry', () => {
    const agent = {
      slug: 'matt-fable',
      name: 'Matt Fable',
      emoji: '🎲',
      owner: 'Matt',
      model: 'claude-fable-5',
    };
    expect(quizConfigSchema.safeParse({ ...base, agents: [agent] }).success).toBe(true);
    // missing required display fields (name/emoji/owner/model) → rejected
    expect(quizConfigSchema.safeParse({ ...base, agents: [{ slug: 'x' }] }).success).toBe(false);
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
