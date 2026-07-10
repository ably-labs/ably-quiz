// S0 latency-spike question set: 12 questions across three bands.
//
// Band meaning (see BRIEF §A3 / §B3 S0.1):
//   general  — general trivia; no grounding needed (control band).
//   ably-docs — facts from Ably's PUBLIC docs; a well-read model may know these.
//   ably-internal — Ably-specific / product-flavoured; where an UN-grounded model
//                   guesses and the shared digest should measurably lift accuracy.
//
// Every ably-docs / ably-internal answer below was verified against
// https://ably.com/llms.txt on 2026-07-11 (see spikes/latency/README.md).

export type Band = 'general' | 'ably-docs' | 'ably-internal';

export type Question = {
  id: string;
  band: Band;
  prompt: string;
  /** Options in fixed A–D order; `answer` is the correct letter. */
  options: [string, string, string, string];
  answer: 'A' | 'B' | 'C' | 'D';
  timeLimitS: number;
};

export const QUESTIONS: Question[] = [
  // ---- Band 1: general trivia (control — grounding irrelevant) ----
  {
    id: 'gen-1',
    band: 'general',
    prompt: 'What is the chemical symbol for gold?',
    options: ['Au', 'Ag', 'Gd', 'Go'],
    answer: 'A',
    timeLimitS: 20,
  },
  {
    id: 'gen-2',
    band: 'general',
    prompt: 'How many continents are there on Earth?',
    options: ['Five', 'Six', 'Seven', 'Eight'],
    answer: 'C',
    timeLimitS: 20,
  },
  {
    id: 'gen-3',
    band: 'general',
    prompt: 'Who wrote the play "Romeo and Juliet"?',
    options: ['Charles Dickens', 'William Shakespeare', 'Jane Austen', 'Mark Twain'],
    answer: 'B',
    timeLimitS: 20,
  },
  {
    id: 'gen-4',
    band: 'general',
    prompt: 'Which is the largest planet in our solar system?',
    options: ['Earth', 'Saturn', 'Jupiter', 'Neptune'],
    answer: 'C',
    timeLimitS: 20,
  },

  // ---- Band 2: Ably public-docs facts (verified against ably.com/llms.txt) ----
  {
    id: 'docs-1',
    band: 'ably-docs',
    prompt: 'In Ably Pub/Sub, what abstraction is used to organize message traffic?',
    options: ['Topics', 'Channels', 'Queues', 'Streams'],
    answer: 'B',
    timeLimitS: 20,
  },
  {
    id: 'docs-2',
    band: 'ably-docs',
    prompt: 'Which Ably feature lets clients be aware of other clients on a channel?',
    options: ['History', 'Webhooks', 'Presence', 'Stats'],
    answer: 'C',
    timeLimitS: 20,
  },
  {
    id: 'docs-3',
    band: 'ably-docs',
    prompt: 'Which two data structures does Ably LiveObjects provide?',
    options: ['LiveMap and LiveCounter', 'Tables and Rows', 'Sets and Lists', 'Graphs and Trees'],
    answer: 'A',
    timeLimitS: 20,
  },
  {
    id: 'docs-4',
    band: 'ably-docs',
    prompt: 'What does the Ably "History" feature let you access?',
    options: [
      'Live presence state',
      'Past message history and rewind',
      'Billing records',
      'Connection logs',
    ],
    answer: 'B',
    timeLimitS: 20,
  },

  // ---- Band 3: Ably-internal-flavoured (grounding-sensitive) ----
  {
    id: 'int-1',
    band: 'ably-internal',
    prompt: 'At Ably, what does "AIT" stand for?',
    options: [
      'Ably Internal Tooling',
      'AI Transport',
      'Async Integration Tier',
      'Adaptive Ingest Topology',
    ],
    answer: 'B',
    timeLimitS: 20,
  },
  {
    id: 'int-2',
    band: 'ably-internal',
    prompt: 'Which of these is a real Ably product?',
    options: ['Ably Ledger', 'Ably Forms', 'LiveSync', 'Ably Vault'],
    answer: 'C',
    timeLimitS: 20,
  },
  {
    id: 'int-3',
    band: 'ably-internal',
    prompt: 'How is Ably AI Transport best described?',
    options: [
      'A video codec',
      'Durable session infrastructure for AI applications',
      'A database ORM',
      'A content delivery network',
    ],
    answer: 'B',
    timeLimitS: 20,
  },
  {
    id: 'int-4',
    band: 'ably-internal',
    prompt: 'Which Ably product is for building collaborative, multiplayer environments?',
    options: ['Pub/Sub', 'Spaces', 'Chat', 'LiveSync'],
    answer: 'B',
    timeLimitS: 20,
  },
];

// Shared "study" digest, curated from Ably's public docs (ably.com/llms.txt).
// The `with-digest` variant injects this; it should lift accuracy on the
// ably-docs and ably-internal bands without helping the general band.
export const ABLY_DIGEST = `Ably is a realtime experience infrastructure platform that provides pub/sub messaging.

Core Pub/Sub concepts:
- Channels organize message traffic within Ably (you publish and subscribe on channels).
- Presence lets clients be aware of the other clients present on a channel.
- History gives access to past message history, with history and rewind features.

Ably products:
- Pub/Sub — realtime pub/sub messaging.
- Chat — messaging and collaboration features.
- Spaces — build collaborative, multiplayer environments.
- LiveObjects — state synchronization via LiveMap and LiveCounter.
- LiveSync — synchronize database changes to clients at scale.
- AI Transport (AIT) — durable session infrastructure for AI applications; streams survive reconnects and sessions span devices.`;
