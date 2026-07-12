# S3.6 load test — results & analysis

Goal (§B3 S3.6 + S3 gate): synthetic load, verify the S1.3 limit findings, and
decide whether to shard `quiz-answers:{0..n}`. **Target scope: reliability up to
~150 concurrent players for this PoC** (Matt, 2026-07-12). Harness is `sim.ts`
(the S3.3 driver, extended with load knobs).

Run against the dev web server (`AUTH_BASE_URL`) + real Ably app `YOUR_APP_ID`.

## Headline

**150 players → 450/450 answers, ZERO dropped**, when players are realistic:
spread across separate processes (real-device analogue) and answering over a
~15 s window (how humans actually answer a 20 s question). Recovery passes
(S3.5). **The PoC target is met.**

The drops seen in earlier runs were **two synthetic artifacts**, not Ably/app
limits — see the analysis.

## Harness knobs added to `sim.ts`

| Env                            | Meaning                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `PLAYERS`                      | synthetic player count                                                                                         |
| `BURST_MS`                     | >0: every player answers within this window (spread evenly)                                                    |
| `RAMP_CHUNK` / `RAMP_DELAY_MS` | open connections in chunks (no connect stampede)                                                               |
| `CLIENT_PREFIX`                | distinct clientId prefix per process (multi-process runs don't collide on the quizmaster's clientId#idx dedup) |
| `NO_PRESENCE=1`                | players skip `presence.enter` (diagnostic)                                                                     |
| `PLAYERS_ONLY=1`               | players answer an external host for 120 s (multi-process / browser-host runs)                                  |

Output reports `connected/PLAYERS`, per-question `received`, total
`answers/expected`, `dropped (%)`, and aggregated publish errors (rate limits
surface as `42911`).

## Measurements

### Realistic topology — players across separate processes (the real case)

| Players | Processes       | Answer spread       | Result                 | Notes                                                                    |
| ------- | --------------- | ------------------- | ---------------------- | ------------------------------------------------------------------------ |
| 150     | 5 (host + 4×35) | ~15 s (~10/s)       | **450/450, 0 dropped** | realistic human timing — **PoC target met**                              |
| 150     | 5 (host + 4×35) | 2.5 s burst (~60/s) | 406/450 (~10% loss)    | artificially harsh burst; loss on the single host subscriber (see below) |

### Single Node process (host + all players in one event loop) — synthetic ceiling

| Players | Answer timing          | Dropped  | Publish errors | Notes                                                                |
| ------- | ---------------------- | -------- | -------------- | -------------------------------------------------------------------- |
| 5       | jitter                 | 0%       | none           | S3.3 baseline                                                        |
| 60      | 4 s burst              | **0.6%** | none           | effectively clean                                                    |
| 100     | 3 s burst              | 14.0%    | none           | one event loop saturating                                            |
| 150     | 3 s burst              | 13.6%    | none           |                                                                      |
| 150     | 3 s burst, NO_PRESENCE | 12.7%    | none           | presence is **not** the cause                                        |
| 250     | 3 s burst (~83/s)      | 12.1%    | none           | `91003` presence-cap hit                                             |
| 250     | 8 s burst (~31/s)      | 15.6%    | none           | under the inbound cap, still drops → burst rate is **not** the cause |
| 300     | 3 s burst, NO_PRESENCE | 11.6%    | none           | 300/300 connected; no `42911` even at ~100/s (2× the cap)            |

## Analysis — the earlier drops were synthetic artifacts

1. **Single-process event-loop contention.** All players + the host in one Node
   process share one event loop. Clean at ≤60 (0.6%), but ≥100 connections in
   one loop lose a flat ~12–14% — independent of burst rate (250 @ 8 s dropped
   _more_ than 250 @ 3 s) and of presence (`NO_PRESENCE` unchanged). Real players
   are separate devices with their own loops; splitting the harness across 5
   processes removed this entirely (150 → 450/450).
2. **Unrealistic burst on the single host subscriber.** Even across processes, a
   2.5 s burst of 150 answers (~60/s) to the _one_ host connection lost ~10% —
   consistent with brushing the ~50 msg/s per-connection delivery cap. Spreading
   answers over ~15 s (~10/s, how humans actually answer a 20 s question)
   restored 450/450. So this only bites under a synthetic thundering-herd, not a
   real quiz.

No `42911` (publish rate limit) was ever raised — not even at 300/3 s ≈ 100/s,
2× the answers-channel inbound cap. Server-side batching (200 ms) absorbed
everything we threw at the fan-in. **Answer-channel sharding is NOT warranted.**

## Ably ceilings (for reference / beyond the PoC)

- **Presence: 250 members/channel on this tier** (`91003`). 150 is comfortably
  under it, so the lobby roster is fine for the PoC. For a real 300-player event,
  move presence to a batched `quiz-lobby:{id}` channel (§B2.1) and/or raise the
  tier. (This app is **not** free-tier — 300 raw connections all succeeded.)
- **Answers inbound: 50 msg/s/channel**; **per-connection delivery ~50 msg/s.**
  Fine for 150 at human answer-timing; a genuine simultaneous 150+ burst would
  approach the host-delivery cap — mitigations (raise the batch interval, or
  shard) are available but unneeded at PoC scale.

## Verdict

- **PoC target (≤150 players) met:** 150 distributed players at realistic timing
  = zero dropped answers; recovery passes; browser E2E passes.
- **Sharding not needed** at this scale.
- Beyond ~150 (toward 300): needs the §B2.1 presence-split + tier bump; that's an
  S5.3 / real-event concern, not this PoC. Also, faithful high-scale load needs a
  distributed rig (the harness supports it via `PLAYERS_ONLY` + `CLIENT_PREFIX`)
  and a deployed auth endpoint — the local Next dev server tops out serving a
  concurrent auth storm from many client processes.

### Reproduce the passing 150 run

```bash
# 4 player processes (35 each), realistic 15s answer spread:
for n in 1 2 3 4; do
  AUTH_BASE_URL=http://localhost:PORT QUIZ_ID=poc150 CLIENT_PREFIX=ext$n \
    PLAYERS_ONLY=1 PLAYERS=35 BURST_MS=15000 RAMP_CHUNK=12 RAMP_DELAY_MS=400 \
    pnpm --filter ably-quiz-spike-sim sim & done
sleep 20   # let them connect
# host + 10 local players drives the quiz over a 20s window:
AUTH_BASE_URL=http://localhost:PORT QUIZ_ID=poc150 CLIENT_PREFIX=host \
  PLAYERS=10 BURST_MS=15000 QUESTION_MS=20000 REVEAL_MS=1000 \
  pnpm --filter ably-quiz-spike-sim sim
# expect: each question "150/10 answers in", "answers=450/30" (all 150 counted)
```
