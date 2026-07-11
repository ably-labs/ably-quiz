# S3.6 load test — results & analysis

Goal (§B3 S3.6 + S3 gate): a synthetic ~300-player burst, verify the S1.3 limit
findings, and decide whether to shard `quiz-answers:{0..n}`. Harness is `sim.ts`
(the S3.3 driver, extended with load knobs — see below).

Run against the dev web server (`AUTH_BASE_URL`) + real Ably app `YOUR_APP_ID`.

## Harness knobs added to `sim.ts`

| Env                            | Meaning                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `PLAYERS`                      | synthetic player count                                                                                            |
| `BURST_MS`                     | >0: every player answers within this window (else the S3.3 jitter)                                                |
| `RAMP_CHUNK` / `RAMP_DELAY_MS` | open connections in chunks to avoid a connect stampede                                                            |
| `CLIENT_PREFIX`                | distinct clientId prefix per process (so multi-process runs don't collide on the quizmaster's clientId#idx dedup) |
| `NO_PRESENCE=1`                | players skip `presence.enter` (diagnostic)                                                                        |
| `PLAYERS_ONLY=1`               | players answer an external host for 120s (multi-process / browser-host runs)                                      |

Output now reports `connected/PLAYERS`, per-question `received/connected`, total
`answers/expected`, `dropped (%)`, and aggregated publish errors (rate limits
show as `42911`).

## Measurements (single Node process: host + all players together)

| Players | Answer timing              | ≈ inbound rate | Dropped  | Publish errors | Notes                                                                 |
| ------- | -------------------------- | -------------- | -------- | -------------- | --------------------------------------------------------------------- |
| 5       | jitter                     | trivial        | 0%       | none           | S3.3 baseline                                                         |
| 60      | 4 s burst                  | ~15/s          | **0.6%** | none           | effectively clean                                                     |
| 150     | 3 s burst                  | ~50/s          | 13.6%    | none           |                                                                       |
| 150     | 3 s burst, **NO_PRESENCE** | ~50/s          | 12.7%    | none           | presence is **not** the cause                                         |
| 250     | 3 s burst                  | ~83/s          | 12.1%    | none           | `91003` presence-cap hit (see below)                                  |
| 250     | **8 s** burst              | ~31/s          | 15.6%    | none           | under the 50/s cap, yet still drops → burst rate is **not** the cause |
| 300     | 3 s burst, NO_PRESENCE     | ~100/s         | 11.6%    | none           | 300/300 connected; no `42911` even at 2× the inbound cap              |

## Analysis — the drops are (almost entirely) a harness artifact, not Ably

The drop rate is **flat at ~12–16% for ≥150 players and independent of two
things we'd expect to matter if it were an Ably limit**:

- **Not the answers inbound-rate cap (50 msg/s).** 250 players spread over 8 s
  (~31/s, well under the cap) dropped _more_ than 250 in a 3 s burst (~83/s).
  And **no `42911` was ever raised** — not even at 300/3s ≈ 100/s, 2× the cap.
  So we never actually observed the fan-in channel rejecting or rate-limiting
  publishes; batching (200 ms) absorbed what we threw at it.
- **Not presence.** With `NO_PRESENCE=1` (no presence traffic on the main
  channel at all), 150 players still dropped 12.7% — essentially unchanged.

What the drops **do** track is the **number of client connections crammed into
one Node process** (60 → 0.6%; 150–300 → ~12%). All players _and_ the host share
a single event loop; under a burst, socket I/O for hundreds of connections
starves some `question`-receive and `answer`-publish callbacks. Each starved
player = one "dropped" answer. Real players are hundreds of _separate_ devices,
each with its own event loop — this contention doesn't exist for them.

A two-process split (host+75 local, +75 external) was attempted; it's confounded
(the external process is itself a single loop of 75 connections, and its
per-question delivery degraded over the run), so it neither confirms nor refutes
cleanly. The single-process trend + the absence of any Ably-side error is the
strong signal.

## Real Ably ceilings that a 300-player quiz must design around

Independent of the harness artifact, two genuine limits were confirmed/consistent
with S1.3 and must be handled before a real 300 event:

1. **Presence: 250 members per channel on this app's tier** (`91003:
maximum number of 250 members exceeded`). The main channel `quiz:{id}` carries
   presence, so the lobby roster caps at ~250. Fix (brief §B2.1): move presence
   to a dedicated **batched** `quiz-lobby:{id}` channel — batching raises presence
   capacity (Standard 5k) and isolates roster churn from control/answers. (Note:
   this app is **not** free-tier — 300 raw connections all succeeded; only
   presence hit 250.)
2. **Answers inbound: 50 msg/s per channel.** A true 300/3 s burst is ~100/s.
   We did **not** observe rejection (batching absorbed our synthetic rate), but a
   genuinely simultaneous 300-device burst could. Mitigation stays as designed:
   shard `quiz-answers:{id}:{0..n}` **only if** a realistic multi-device burst
   shows `42911` or delivery loss. Not yet demonstrated → **do not shard yet.**

## Verdict / next steps for the S3 gate

- The app + Ably are **clean at the scale a single machine can honestly generate**
  (0.6% at 60). No evidence of an app-level answer-loss bug.
- The literal gate ("300 synthetic, zero dropped answers") **cannot be
  demonstrated from one machine** — the synthetic ceiling is the local process,
  not the platform. It needs either:
  - a **distributed load rig** — the host as its own process/browser, players
    spread across several processes/machines (harness supports this via
    `PLAYERS_ONLY` + `CLIENT_PREFIX`), or
  - accepting the 60-player clean result + the browser E2E as sufficient
    evidence that the pipeline is correct, and treating 300 as a capacity
    (tier/config) exercise rather than a correctness one.
- **Roster at 300** needs the §B2.1 presence-split (batched `quiz-lobby`
  channel) — an app-config + code change, tracked as the follow-up.

Recorded in PROGRESS.md (Blocked + Deviations).
