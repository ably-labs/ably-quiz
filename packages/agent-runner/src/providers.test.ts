import { describe, expect, it } from 'vitest';
import { extractAnswer, extractAnswerLoose } from './providers';

describe('extractAnswer (strict, incremental)', () => {
  it('parses the answer JSON that follows a think-aloud', () => {
    const t = 'Gold is Au.\n{"choice":"A","confidence":0.9,"quip":"Au natural"}';
    expect(extractAnswer(t)).toEqual({ choice: 'A', confidence: 0.9, quip: 'Au natural' });
  });

  it('returns null until the JSON object is complete', () => {
    expect(extractAnswer('thinking… {"choice":"A","confidence":0.5')).toBeNull();
  });

  it('uppercases the choice and clamps confidence to 0..1', () => {
    expect(extractAnswer('{"choice":"b","confidence":2,"quip":"x"}')).toEqual({
      choice: 'B',
      confidence: 1,
      quip: 'x',
    });
  });

  it('rejects a choice outside A–D', () => {
    expect(extractAnswer('{"choice":"E","confidence":0.5,"quip":"x"}')).toBeNull();
  });
});

describe('extractAnswerLoose (fallback for malformed JSON)', () => {
  it('recovers the choice when an unescaped quote in the quip breaks strict JSON (S0 failure mode)', () => {
    const t = `Presence tracks who's online.\n{"choice":"C","confidence":0.99,"quip":"the ultimate "who's online" detector!"}`;
    expect(extractAnswer(t)).toBeNull(); // strict can't parse it
    const loose = extractAnswerLoose(t);
    expect(loose?.choice).toBe('C');
    expect(loose?.confidence).toBe(0.99);
  });

  it('returns null when there is no choice to recover', () => {
    expect(extractAnswerLoose('I have no idea, sorry.')).toBeNull();
  });
});
