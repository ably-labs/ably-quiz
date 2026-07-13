// The delta→UIMessageChunk bridge (BRIEF §B2.7 step 2). The S4.1 runner streams
// a model call and reports text via `onThinking(delta, fullText)`; AIT's
// `run.pipe()` wants a `ReadableStream<UIMessageChunk>` of the visible thinking.
// This maps one to the other — the ~10-line adapter the findings doc calls for
// (docs/AIT-DX-FINDINGS.md) — and is the one piece of the AIT wiring that is
// pure enough to unit-test (the Ably/AIT plumbing is integration-tested live).
//
// The chunk sequence is the AI SDK's UIMessage stream shape:
//   start · text-start · text-delta* · text-end · finish
// The visible think-aloud is only the prose BEFORE the answer JSON (§B2.7:
// "visible thinking = the model's output"), so we clip at the first '{' — the
// strict `{choice,confidence,quip}` object never reaches the on-screen stream.

import type { UIMessageChunk } from 'ai';

export type ThinkAloudStream = {
  /** Feed to `answerQuestion({ onThinking })` — same `(delta, fullText)` shape. */
  onThinking: (delta: string, fullText: string) => void;
  /** The stream to hand to `run.pipe()`. */
  readonly stream: ReadableStream<UIMessageChunk>;
  /** Emit `text-end` + `finish` and close. Idempotent. Call when answering ends. */
  close: () => void;
  /** Abort the stream with an error (a hard provider failure). Idempotent. */
  fail: (reason?: unknown) => void;
};

/**
 * Build a think-aloud stream for one question's run. `messageId` ties the
 * text-start/delta/end chunks together (the AI SDK keys a text part by id).
 */
export function createThinkAloudStream(messageId: string): ThinkAloudStream {
  let controller: ReadableStreamDefaultController<UIMessageChunk> | null = null;
  // How many chars of the visible prefix we've already emitted, so each delta
  // enqueues only the newly-revealed slice.
  let emitted = 0;
  let closed = false;

  const stream = new ReadableStream<UIMessageChunk>({
    start(ctrl) {
      controller = ctrl;
      // Open the message and its single text part up front, before any token —
      // an empty think-aloud (all-JSON output) still yields a valid message.
      ctrl.enqueue({ type: 'start' });
      ctrl.enqueue({ type: 'text-start', id: messageId });
    },
  });

  // The visible think-aloud is everything before the answer JSON's first '{'.
  const visibleOf = (fullText: string): string => {
    const brace = fullText.indexOf('{');
    return brace === -1 ? fullText : fullText.slice(0, brace);
  };

  const onThinking = (_delta: string, fullText: string): void => {
    if (closed || !controller) return;
    // Derive the new slice from fullText (not the raw delta) so a delta that
    // straddles the '{' boundary is clipped exactly at the JSON.
    const visible = visibleOf(fullText);
    if (visible.length <= emitted) return;
    const chunk = visible.slice(emitted);
    emitted = visible.length;
    controller.enqueue({ type: 'text-delta', id: messageId, delta: chunk });
  };

  const close = (): void => {
    if (closed || !controller) return;
    closed = true;
    controller.enqueue({ type: 'text-end', id: messageId });
    controller.enqueue({ type: 'finish' });
    controller.close();
  };

  const fail = (reason?: unknown): void => {
    if (closed || !controller) return;
    closed = true;
    controller.error(
      reason instanceof Error ? reason : new Error(String(reason ?? 'stream failed')),
    );
  };

  return { onThinking, stream, close, fail };
}
