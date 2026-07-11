// Readable quiz ids, e.g. "brave-otter-482" (matches the auth id rule
// ^[a-zA-Z0-9_-]{1,64}$). Human-friendly for links read aloud in a room.

const ADJECTIVES = [
  'brave',
  'swift',
  'clever',
  'quiet',
  'bright',
  'lucky',
  'bold',
  'calm',
  'eager',
  'fair',
  'keen',
  'merry',
  'nimble',
  'proud',
  'wise',
  'zesty',
];
const NOUNS = [
  'otter',
  'falcon',
  'maple',
  'comet',
  'harbor',
  'ember',
  'pixel',
  'quartz',
  'raven',
  'summit',
  'tiger',
  'willow',
  'anchor',
  'basil',
  'cedar',
  'delta',
];

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}

export function generateQuizId(): string {
  const num = 100 + Math.floor(Math.random() * 900);
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${num}`;
}
