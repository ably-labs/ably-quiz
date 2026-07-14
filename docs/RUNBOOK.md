# Runbook — running a live quiz (S5.4)

The operational guide for quiz day: what to check before, how to drive a live game,
and what to do when something breaks. The quiz is built entirely on Ably (no
database), so most recovery is automatic — this document is precise about what is
automatic and what needs a hand.

## Before the event

- **Confirm which keys are present** in `.env.local` — each unlocks a layer, and a
  missing key degrades gracefully rather than failing:
  - `ABLY_API_KEY` — required for **any** quiz (it is the whole backend). Humans-only needs only this.
  - `AI_GATEWAY_API_KEY` — the **AI agents** (all providers route through one Vercel AI Gateway key).
  - `ANTHROPIC_API_KEY` — **grounded** Anthropic turns and `pnpm agents:study`.
- **Refresh agent cribs (optional):** `pnpm agents:study` re-researches Ably knowledge
  through the read-only MCP into each agent's `crib.md`. Auth is **interactive OAuth**
  (it prints a link, you sign in through Okta, a loopback catches the callback — no
  token stored). Skip it and agents run on their committed cribs.
- **Load and sanity-check your questions** on `/create`: paste the grid, set a default
  time per question, pick a **scoring algorithm** (`classic` / `fastest-finger` /
  `steady`), and tick the agents you want in the field.
- **Trust the agent-health preflight.** `/host` pings each declared agent
  (`/api/agent-health`); any agent whose model won't answer is shown **greyed
  "unavailable"**, dropped from the expected-answer count, and never fired at — a
  dead model can't stall the quiz.

## Running a live quiz

Do everything on the **host laptop** (the quiz definition, including the correct
answers, lives only in that browser):

1. **Create** the quiz on `/create` → you land on **`/host`**.
2. **Project `/screen`** on the big screen (the _Open shared screen_ link on `/host`).
   It shows the join QR, live tallies, the tug-of-war, and the podium — and needs no
   host key, so it works from any device.
3. **Players scan the QR** to `/play?quiz=<id>`, pick a nickname, and land in the lobby.
4. **(Optional) Authenticate agents** for grounding — the _Authenticate agents_ banner
   runs a per-session Okta OAuth so Anthropic agents can look up Ably knowledge. Or just
   **Start**: if you start with declared agents ungrounded, the app warns you first.
5. **Drive the question loop.** Each question broadcasts to phones and screen and fires
   one agent turn each; it **auto-advances when everyone has answered or the timer
   expires**. Repeat to the end.
6. **Podium → commentator verdict → counterfactual.** The end screen shows the podium,
   an AI commentator's spoken verdict, and the "by the way…" panel that re-ranks the
   final standings under every scoring algorithm — flagging any that would crown a
   different winner.

## Failure playbook

**An agent's model is down.** Handled before it can hurt you: the preflight greys the
agent as unavailable, excludes it from the expected-answer count, and fires no turn for
it. The question still auto-advances on the remaining answerers; the quiz continues.
(Per-turn `try/catch` is the backstop if a model dies mid-question.)

**The host machine or browser dies mid-quiz.** Reopen **`/host?quiz=<id>` on the same
machine** — the quiz definition is in that browser's `localStorage`, so a different
machine can't recover it (`/host` will say _"Open host controls from the machine that
created this quiz"_). On reload the quizmaster **rebuilds phase, tallies, and scores
from Ably channel history** and resumes. Players and `/screen` recover from history
automatically and need no action.

**A player reloads or their phone sleeps.** They **auto-rejoin** with the same identity
and score — nickname and client id are persisted per-quiz in `sessionStorage`, so a
refresh skips the join screen and restores their standing.

**Ably degraded or a network blip.** Clients auto-reconnect and **replay missed
messages from channel history** (persistence is on for all three channel roles); answers
are durably persisted on the `quiz-answers:{id}` fan-in, so nothing in flight is lost.
What's automatic: player and `/screen` recovery, and answer durability. What needs a
hand: if the **host** tab itself is the thing that dropped and can't reconnect, reload
`/host?quiz=<id>` on the host machine (above) to rebuild state from history.

## Scale

- **Verified PoC: ≤ 150 concurrent players** — 150 distributed players answered with
  **zero dropped answers** (450/450) at realistic timing. See
  [../spikes/quiz-sim/LOAD-RESULTS.md](../spikes/quiz-sim/LOAD-RESULTS.md).
- **The path to ~300 is documented but not yet exercised:** split lobby presence onto a
  dedicated **batched `quiz-lobby:{id}` channel** (the roster caps at ~250 members/channel
  on the current tier) and bump the Ably tier. Answer-channel sharding
  (`quiz-answers:{id}:{0..n}`) is only needed if a genuine high-scale burst ever shows
  rate-limit loss — not observed at PoC scale, so don't pre-shard. **Treat 300 as
  pre-real-event work**, not a tested configuration.

## Known limitations

- **Agent channels are status-only mid-question; quips release at reveal (S5.3).** The
  on-demand `/api/agent-turn` publishes only status (_thinking…_ / ✓ / ⚠️) to the
  player-readable `quiz-agent:{id}:{slug}` channels — no reasoning text, no quip — so a
  devtools-savvy player can no longer peek at the answer on the wire. Each agent's
  one-liner rides the host-subscribe-only answers fan-in; the host gathers them per
  question and re-releases them at reveal via an `agent-quips` message on the main
  channel, which is where `/screen` reads the "Agent takes". (The persistent co-hosted
  runner, `pnpm agents:start`, is a separate dev path and still streams its think-aloud
  over AIT — the default on-demand path above does not.)
