// Ably adapters that plug real Ably + LiveObjects into the tested core engine
// (@ably-quiz/core Broadcaster / QuizStore). The core stays I/O-free; this is
// the only place that touches the wire.

import type * as Ably from 'ably';
import {
  answersChannel,
  mainChannel,
  parseControlMessage,
  parseCounterfactual,
  type Broadcaster,
  type Choice,
  type ControlHistoryEntry,
  type ControlMessage,
  type CounterfactualPayload,
  type InboundAnswer,
  type Phase,
  type QuizConfig,
  type QuizStore,
  type ScoreboardEntry,
  type Tallies,
} from '@ably-quiz/core';

/** Event name for the one-shot counterfactual payload on the main channel (§S5.1). */
export const COUNTERFACTUAL_EVENT = 'counterfactual';

const EMPTY_TALLIES: Tallies = { A: 0, B: 0, C: 0, D: 0 };

// Minimal structural view of the LiveObjects root PathObject (the SDK's full
// generic types are large; we only need set/get/subscribe over JSON values).
interface LiveRoot {
  set(key: string, value: unknown): Promise<void>;
  get(key: string): { value(): unknown } | undefined;
  subscribe(listener: () => void): unknown;
}
interface ObjectsChannel {
  object: { get(): Promise<LiveRoot> };
}

function rootOf(channel: Ably.RealtimeChannel): Promise<LiveRoot> {
  return (channel as unknown as ObjectsChannel).object.get();
}

/**
 * Get the main channel with the channel MODES the operation needs. LiveObjects
 * requires object modes to be requested explicitly (they're not in the default
 * set), so every accessor of the main channel on a given client must use the
 * SAME modes — hence this single helper. Readers get object-subscribe; the host
 * additionally gets publish + object-publish.
 */
export function getMainChannel(
  client: Ably.Realtime,
  quizId: string,
  opts: { write: boolean },
): Ably.RealtimeChannel {
  const modes: Ably.ChannelMode[] = [
    'SUBSCRIBE',
    'PRESENCE',
    'PRESENCE_SUBSCRIBE',
    'OBJECT_SUBSCRIBE',
  ];
  if (opts.write) modes.push('PUBLISH', 'OBJECT_PUBLISH');
  return client.channels.get(mainChannel(quizId), { modes });
}

/**
 * Publishes control on the main channel and resolves each publish with the
 * message's authoritative Ably server timestamp (T₀). The host is the only
 * control publisher and its own echoes arrive in publish order, so we match
 * pending publishes to echoes FIFO.
 */
export class AblyBroadcaster implements Broadcaster {
  private readonly channel: Ably.RealtimeChannel;
  private readonly pending: ((serverTs: number) => void)[] = [];
  private ready: Promise<unknown>;

  constructor(client: Ably.Realtime, quizId: string) {
    this.channel = getMainChannel(client, quizId, { write: true });
    this.ready = this.channel.subscribe('control', (msg) => {
      const resolve = this.pending.shift();
      if (resolve) resolve(msg.timestamp ?? Date.now());
    });
  }

  async publishControl(msg: ControlMessage): Promise<number> {
    await this.ready;
    const serverTs = new Promise<number>((resolve) => this.pending.push(resolve));
    await this.channel.publish('control', msg);
    return serverTs;
  }
}

/**
 * Writes quiz state to LiveObjects on the main channel. phase/config flush
 * immediately (rare, important); tallies/scoreboard are coalesced on a short
 * timer so a 300-answer burst becomes a handful of object ops, not hundreds.
 */
export class AblyLiveStore implements QuizStore {
  private rootPromise: Promise<LiveRoot>;
  private tallies: Tallies = { ...EMPTY_TALLIES };
  private scoreboard: Record<string, ScoreboardEntry> = {};
  private dirty = new Set<'tallies' | 'scoreboard'>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    client: Ably.Realtime,
    quizId: string,
    private readonly flushMs = 150,
  ) {
    this.rootPromise = rootOf(getMainChannel(client, quizId, { write: true }));
  }

  setConfig(config: QuizConfig): void {
    void this.write('config', config);
  }

  setPhase(phase: Phase, questionIdx: number): void {
    void this.write('phase', phase);
    void this.write('questionIdx', questionIdx);
  }

  resetTally(): void {
    this.tallies = { ...EMPTY_TALLIES };
    void this.write('tallies', this.tallies);
  }

  setTally(choice: Choice, count: number): void {
    this.tallies = { ...this.tallies, [choice]: count };
    this.markDirty('tallies');
  }

  setScoreboardEntry(clientId: string, entry: ScoreboardEntry): void {
    this.scoreboard = { ...this.scoreboard, [clientId]: entry };
    this.markDirty('scoreboard');
  }

  private markDirty(key: 'tallies' | 'scoreboard'): void {
    this.dirty.add(key);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const keys = [...this.dirty];
      this.dirty.clear();
      for (const k of keys) void this.write(k, k === 'tallies' ? this.tallies : this.scoreboard);
    }, this.flushMs);
  }

  private async write(key: string, value: unknown): Promise<void> {
    // Best-effort: every writer here is fire-and-forget (`void this.write`), and
    // the host re-writes the whole value on each change, so a single failure is
    // recoverable. A coalesced flush can also fire just as the connection closes
    // (host refresh / tab unload) — swallow that so it never surfaces as an
    // unhandled rejection (which crashes Node and noisily logs in the browser).
    try {
      const root = await this.rootPromise;
      await root.set(key, value);
    } catch (err) {
      console.warn(`quiz state write (${key}) failed:`, err);
    }
  }
}

// --- Reader side (screen / play): live quiz state from LiveObjects ----------
export type LiveQuizState = {
  phase: Phase;
  questionIdx: number;
  config: QuizConfig | null;
  tallies: Tallies;
  scoreboard: Record<string, ScoreboardEntry>;
};

const INITIAL_STATE: LiveQuizState = {
  phase: 'lobby',
  questionIdx: -1,
  config: null,
  tallies: { ...EMPTY_TALLIES },
  scoreboard: {},
};

/** Subscribe to the LiveObjects-backed quiz state; calls back with the full
 *  state on every change (and once immediately). Returns an unsubscribe fn. */
export async function subscribeQuizState(
  channel: Ably.RealtimeChannel,
  onState: (state: LiveQuizState) => void,
): Promise<() => void> {
  const root = await rootOf(channel);
  const read = (): LiveQuizState => ({
    phase: (root.get('phase')?.value() as Phase) ?? 'lobby',
    questionIdx: (root.get('questionIdx')?.value() as number) ?? -1,
    config: (root.get('config')?.value() as QuizConfig) ?? null,
    tallies: (root.get('tallies')?.value() as Tallies) ?? { ...EMPTY_TALLIES },
    scoreboard: (root.get('scoreboard')?.value() as Record<string, ScoreboardEntry>) ?? {},
  });
  root.subscribe(() => onState(read()));
  onState(read());
  return () => undefined;
}

// --- Recovery: channel-history readers (§B2.3, S3.5) ------------------------
// Persistence is enabled on the quiz namespaces (docs/ABLY-SETUP.md), so both
// channels' history is the durable log the host replays to rebuild state and a
// refreshed player uses to re-derive the in-flight question.

/** Page through a channel's full history, chronological (oldest first). */
async function pageAll(channel: Ably.RealtimeChannel): Promise<Ably.Message[]> {
  const out: Ably.Message[] = [];
  let page: Ably.PaginatedResult<Ably.Message> | null = await channel.history({
    direction: 'forwards',
    limit: 1000,
  });
  while (page) {
    out.push(...page.items);
    page = page.hasNext() ? await page.next() : null;
  }
  return out;
}

/** Control history on the main channel, chronological — feeds Quizmaster.recover. */
export async function loadControlHistory(
  main: Ably.RealtimeChannel,
): Promise<ControlHistoryEntry[]> {
  const out: ControlHistoryEntry[] = [];
  for (const m of await pageAll(main)) {
    if (m.name !== 'control') continue;
    const msg = parseControlMessage(m.data);
    if (msg) out.push({ msg, serverTs: m.timestamp ?? 0 });
  }
  return out;
}

/** Answer history on the fan-in channel — feeds Quizmaster.recover. */
export async function loadAnswerHistory(answers: Ably.RealtimeChannel): Promise<InboundAnswer[]> {
  return (await pageAll(answers))
    .filter((m) => m.name === 'answer')
    .map((m) => ({ clientId: m.clientId ?? '', data: m.data, serverTs: m.timestamp ?? 0 }));
}

/** Host publishes the "by the way…" counterfactual once, at `analysis` (§S5.1). */
export async function publishCounterfactual(
  main: Ably.RealtimeChannel,
  payload: CounterfactualPayload,
): Promise<void> {
  await main.publish(COUNTERFACTUAL_EVENT, payload);
}

/** Latest counterfactual from main-channel history — for a screen/player that
 *  joins (or reloads) after the payload was published. Newest wins. */
export async function loadCounterfactual(
  main: Ably.RealtimeChannel,
): Promise<CounterfactualPayload | null> {
  let latest: CounterfactualPayload | null = null;
  for (const m of await pageAll(main)) {
    if (m.name !== COUNTERFACTUAL_EVENT) continue;
    const payload = parseCounterfactual(m.data);
    if (payload) latest = payload; // forwards order → last match is newest
  }
  return latest;
}

export { answersChannel, mainChannel, INITIAL_STATE };
