import type { UIMessageChunk } from 'ai';
import { describe, expect, it } from 'vitest';
import { createThinkAloudStream } from './think-stream';

/** Drain a ReadableStream to an array of chunks. */
async function drain(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const out: UIMessageChunk[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

/** Concatenate every text-delta's text — the visible think-aloud as streamed. */
function streamedText(chunks: UIMessageChunk[]): string {
  return chunks
    .filter((c): c is Extract<UIMessageChunk, { type: 'text-delta' }> => c.type === 'text-delta')
    .map((c) => c.delta)
    .join('');
}

describe('createThinkAloudStream (delta→UIMessageChunk)', () => {
  it('emits start · text-start · text-delta* · text-end · finish in order', async () => {
    const t = createThinkAloudStream('m1');
    t.onThinking('Gold ', 'Gold ');
    t.onThinking('is Au.', 'Gold is Au.');
    t.close();

    const chunks = await drain(t.stream);
    expect(chunks.map((c) => c.type)).toEqual([
      'start',
      'text-start',
      'text-delta',
      'text-delta',
      'text-end',
      'finish',
    ]);
    expect(streamedText(chunks)).toBe('Gold is Au.');
  });

  it('ties every text chunk to the given message id', async () => {
    const t = createThinkAloudStream('q4-think');
    t.onThinking('Hi', 'Hi');
    t.close();
    const chunks = await drain(t.stream);
    for (const c of chunks) {
      if (c.type === 'text-start' || c.type === 'text-delta' || c.type === 'text-end') {
        expect(c.id).toBe('q4-think');
      }
    }
  });

  it('clips at the answer JSON — the {choice,…} object never streams', async () => {
    const t = createThinkAloudStream('m');
    // The runner reports the full accumulating text incl. the trailing JSON.
    t.onThinking('Silver? No, gold. ', 'Silver? No, gold. ');
    t.onThinking('{"choice":"A"', 'Silver? No, gold. {"choice":"A"');
    t.onThinking(',"confidence":0.9}', 'Silver? No, gold. {"choice":"A","confidence":0.9}');
    t.close();

    const chunks = await drain(t.stream);
    const text = streamedText(chunks);
    expect(text).toBe('Silver? No, gold. ');
    expect(text).not.toContain('{');
  });

  it('clips a delta that straddles the prose/JSON boundary', async () => {
    const t = createThinkAloudStream('m');
    // One delta carries both the end of the prose and the start of the JSON.
    t.onThinking('Because Au. {"choice":"B"}', 'Because Au. {"choice":"B"}');
    t.close();

    const chunks = await drain(t.stream);
    expect(streamedText(chunks)).toBe('Because Au. ');
  });

  it('handles an empty think-aloud (all-JSON output) as a valid message', async () => {
    const t = createThinkAloudStream('m');
    t.onThinking('{"choice":"C","confidence":1}', '{"choice":"C","confidence":1}');
    t.close();

    const chunks = await drain(t.stream);
    expect(chunks.map((c) => c.type)).toEqual(['start', 'text-start', 'text-end', 'finish']);
    expect(streamedText(chunks)).toBe('');
  });

  it('is idempotent on close — no double text-end/finish', async () => {
    const t = createThinkAloudStream('m');
    t.onThinking('x', 'x');
    t.close();
    t.close();
    t.onThinking('ignored', 'x ignored'); // after close: dropped
    const chunks = await drain(t.stream);
    expect(chunks.filter((c) => c.type === 'finish')).toHaveLength(1);
    expect(streamedText(chunks)).toBe('x');
  });

  it('fail() aborts the stream with an error', async () => {
    const t = createThinkAloudStream('m');
    t.onThinking('partial', 'partial');
    t.fail(new Error('provider exploded'));
    await expect(drain(t.stream)).rejects.toThrow('provider exploded');
  });
});
