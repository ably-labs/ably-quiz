// A stable per-browser player id base, so a refresh keeps the same clientId
// (presence identity + first-answer-wins dedupe). The nickname is separate
// (shown in presence); this is just the durable handle.

const KEY = 'ably-quiz:player-id';

export function getPlayerBaseId(): string {
  if (typeof window === 'undefined') return 'anon';
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    window.localStorage.setItem(KEY, id);
  }
  return id;
}
