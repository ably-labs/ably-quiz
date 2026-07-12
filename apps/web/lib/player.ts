// A stable per-TAB player id base, so a refresh keeps the same clientId
// (presence identity + first-answer-wins dedupe + score recovery), while each
// browser tab is a DISTINCT player.
//
// sessionStorage (not localStorage) is deliberate: it survives a page reload
// within the same tab (recovery works), but is scoped per tab — so opening a
// second tab is a second player. localStorage would share one identity across
// every tab of the browser, which is invisible in a real event (each person is
// on their own device) but wrong for multi-tab testing and for the occasional
// user who opens two tabs. Trade-off: closing a tab and reopening starts fresh
// (you left the game), which is the behaviour we want.

const KEY = 'ably-quiz:player-id';

export function getPlayerBaseId(): string {
  if (typeof window === 'undefined') return 'anon';
  let id = window.sessionStorage.getItem(KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    window.sessionStorage.setItem(KEY, id);
  }
  return id;
}
