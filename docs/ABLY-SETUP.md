# Ably setup (S1.3)

Ably is the entire backend (§B2). This documents the app configuration the quiz
depends on, an empirically-verified finding about the fairness clock, and the
platform limits that matter at 300 players.

- **App id:** `YOUR_APP_ID` (dev/build app; key in repo-root `.env.local` as `ABLY_API_KEY`, gitignored).
- **Configured by:** the Ably dashboard (the `ably` CLI is only logged into the
  separate "Ably for CLI CI" account, which can't manage this app — see
  [Reconfiguring](#reconfiguring) for the Control-API/CLI equivalents).

## Channel scheme & namespaces

Ably namespaces are matched by the channel-name segment **before the first
colon** (`quiz:abc:answers` is in the `quiz` namespace, not `quiz-answers`).
Because the three channel roles need _different_ rules — and batching must be ON
for answers but OFF for control — they use **distinct prefixes**:

| Namespace      | Channel                  | Role                                            | Rules enabled                                                                                                                     |
| -------------- | ------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `quiz`         | `quiz:{id}`              | control events, lobby presence, LiveObjects     | **Persist all messages**. Batching **off** (control must not be delayed).                                                         |
| `quiz-answers` | `quiz-answers:{id}`      | fan-in answers (only the quizmaster subscribes) | **Persist all messages** · **Server-side batching**, interval **200 ms**.                                                         |
| `quiz-agent`   | `quiz-agent:{id}:{slug}` | one AI Transport session per agent              | **Persist all messages** · **Message annotations, updates, deletes, and appends** (required for token streaming; public preview). |

> **Deviation from the §B2 diagram.** The brief diagram writes `quiz:{id}:answers`
> and `quiz:{id}:agent:{slug}`; those collapse to the single `quiz` namespace, so
> per-role rules are impossible. Renamed to `quiz-answers:{id}` and
> `quiz-agent:{id}:{slug}`. Same architecture; encoded in the protocol at S2.1.

Persistence is on everywhere so channel **history is the durable audit log**
(recovery + counterfactual scoring, §B2.1/§B2.3). **LiveObjects** on `quiz:{id}`
may also need app-level enablement — to be confirmed when LiveObjects is wired
(S2.4/S3), not required for S1.

## Fairness clock under batching — VERIFIED (§B2.1)

The question `control` message's server timestamp is T₀; each answer's server
timestamp is T₁; `elapsedMs = T₁ − T₀`, one clock for everyone (§B2.2). The
answers channel is batched, and the docs don't say whether messages inside a
batch keep their own timestamps — so we measured it
(`spikes/ably-batching/batch-timestamps.ts`).

**Finding:** per-message server timestamps are **NOT preserved under real batch
load** — messages flushed in the same batch **share a server timestamp**.

| Probe                                                           | Result                                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| 3 msgs, one connection, ~40ms apart (too low-rate to batch)     | 3/3 **distinct** timestamps (+0/+50/+102ms)                     |
| Same, on non-batched `quiz` namespace (control)                 | 3/3 distinct                                                    |
| **20 connections × 1 msg, simultaneous (triggers the batcher)** | **~2 distinct timestamps** across 20 messages, all within ~50ms |

The SDK delivers batched messages as individual message objects (not an array
envelope), each carrying the batch's (quantized) timestamp.

**Decision (per the §B2.1 fallback):** **accept the quantization.** `elapsedMs` is
accurate to **≤ the batching interval (200ms)** — on a 20s window that's ~1%,
uniform for everyone, so it's fair; answers in the same flush tie on speed, which
is acceptable for an ~80-person quiz. Batching stays ON for `quiz-answers`
because at 300-scale it is **required** to keep the single quizmaster subscriber
under its 50 msg/s outbound delivery limit (see below), and it lifts presence
capacity and cuts cost.

**Tuning levers** (revisit at the S3.6 load test / dry run if finer speed
resolution is wanted): lower `batchingInterval` to 100ms, or drop batching on
`quiz-answers` entirely — the fan-in design alone avoids the N² rebroadcast
problem and at ~80 players the quizmaster can absorb N direct deliveries.

## Limits that matter at 300 players (from `/docs/general/limits`)

| Limit                                 | Value                                                                              | Relevance                                                                                                                                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Publish rate per connection**       | **25 msg/s** (measured — error `42911`)                                            | A player/agent publishes ~1 answer/question, so fine. But synthetic load (S3.6) must spread publishes across many connections, never hammer one.                                                                                            |
| **Inbound publish rate per channel**  | **50 msg/s** (all tiers)                                                           | 300 answers in a ~3s burst ≈ 100/s inbound to `quiz-answers:{id}` → **over the cap**. Batching compacts _delivery_, not _inbound_, so at true 300-burst we shard `quiz-answers:{id}:{0..n}`. Measure at S3.6; shard only if numbers demand. |
| **Outbound rate per connection**      | **50 msg/s**                                                                       | The quizmaster is one connection subscribing to all answers — this is why batching is on `quiz-answers`: a 300-answer burst reaches it as a handful of batch deliveries, not 300.                                                           |
| **Presence members per channel**      | **200** default; **up to 5,000** with batching (Standard), 10k Pro, 20k Enterprise | ~80–300 lobby members fits. If presence join/leave bursts strain `quiz:{id}` at 300, move presence to a dedicated batched `quiz:{id}:lobby` channel (§B2.1).                                                                                |
| **Concurrent connections / channels** | Free 200 · Standard 10,000 · Pro 50,000 · Enterprise unlimited                     | 300 players + agents needs a paid tier; the free cap (200) is below 300.                                                                                                                                                                    |
| **Max message size**                  | 64 KiB (Free/Standard) · 256 KiB (Pro/Enterprise)                                  | Answers and control messages are tiny.                                                                                                                                                                                                      |

## Reconfiguring

Done via the dashboard here. The Control-API / CLI equivalents (for an account
the CLI can manage) are:

```sh
# batching on an answers namespace
ably apps rules create --name quiz-answers --persisted --batching-enabled --batching-interval 200

# AIT appends/annotations on the agent-session namespace
# (dashboard toggle: "Message annotations, updates, deletes, and appends")
```

Control API: `POST /apps/{app_id}/namespaces` with
`{ "id": "quiz-answers", "persisted": true, "batchingEnabled": true, "batchingInterval": 200 }`.

## Re-verify

```sh
pnpm --dir spikes/ably-batching batch-test   # re-runs the timestamp probe
```
