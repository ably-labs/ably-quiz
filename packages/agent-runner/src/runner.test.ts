import { describe, expect, it } from 'vitest';
import type { StreamArgs, StreamFn, StreamResult } from './providers';
import { answerQuestion } from './runner';
import type { AgentManifest, Question } from './schema';

const agent: AgentManifest = {
  name: 'Tester',
  slug: 'tester',
  emoji: '🤖',
  owner: 'me',
  provider: 'anthropic',
  model: 'claude-fable-5',
};
const question: Question = {
  idx: 0,
  prompt: 'What is 2+2?',
  options: ['4', '5', '6', '7'],
  limitMs: 20_000,
};

/** A stream that returns a canned result and records the args it was called with. */
function cannedStream(result: Partial<StreamResult> & { text: string }): {
  stream: StreamFn;
  seen: () => StreamArgs;
} {
  let seen: StreamArgs | undefined;
  const stream: StreamFn = (args) => {
    seen = args;
    args.onDelta?.(result.text, result.text);
    return Promise.resolve({
      ttftMs: 5,
      answerMs: result.answer ? 10 : null,
      totalMs: 15,
      aborted: false,
      answer: null,
      toolCalls: [],
      ...result,
    });
  };
  return {
    stream,
    seen: () => {
      if (!seen) throw new Error('stream was not called');
      return seen;
    },
  };
}

describe('answerQuestion (§B2.7 answer core)', () => {
  it('returns the strict answer and the think-aloud, and grounds the prompt', async () => {
    const { stream, seen } = cannedStream({
      text: 'Two plus two is four.\n{"choice":"A","confidence":0.99,"quip":"easy"}',
      answer: { choice: 'A', confidence: 0.99, quip: 'easy' },
    });
    const res = await answerQuestion({ ...agent, personality: 'Witty and terse.' }, question, {
      stream,
      crib: 'MATHS FACT: 2+2=4',
      digest: 'ABLY DIGEST',
    });

    expect(res.choice).toBe('A');
    expect(res.confidence).toBe(0.99);
    expect(res.thinking).toBe('Two plus two is four.');
    expect(res.forcedGuess).toBe(false);

    const args = seen();
    expect(args.system).toContain('Witty and terse.');
    expect(args.system).toContain('MATHS FACT: 2+2=4');
    expect(args.system).toContain('ABLY DIGEST');
    expect(args.user).toContain('A) 4');
    expect(args.user).toContain('D) 7');
    expect(args.provider).toBe('anthropic');
  });

  it('falls back to a loose parse when strict JSON is malformed', async () => {
    const { stream } = cannedStream({
      text: 'Presence.\n{"choice":"C","confidence":0.8,"quip":"who is "online"?"}',
      answer: null, // strict parse failed upstream
    });
    const res = await answerQuestion(agent, question, { stream });
    expect(res.choice).toBe('C');
    expect(res.forcedGuess).toBe(true);
  });

  it('scores 0 (null choice) when nothing usable streamed, e.g. a deadline abort', async () => {
    const { stream } = cannedStream({
      text: 'still thinking, no answer yet',
      answer: null,
      aborted: true,
    });
    const res = await answerQuestion(agent, question, { stream });
    expect(res.choice).toBeNull();
    expect(res.timedOut).toBe(true);
    expect(res.forcedGuess).toBe(true);
  });

  it('maps only as many option letters as there are options', async () => {
    const { stream, seen } = cannedStream({
      text: '{"choice":"B","confidence":0.5,"quip":"x"}',
      answer: { choice: 'B', confidence: 0.5, quip: 'x' },
    });
    await answerQuestion(agent, { ...question, options: ['yes', 'no'] }, { stream });
    const args = seen();
    expect(args.user).toContain('A) yes');
    expect(args.user).toContain('B) no');
    expect(args.user).not.toContain('C)');
  });
});
