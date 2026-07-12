# Build progress — Carbon vs Silicon

> Maintained by the build agent. Check tasks off as they land (task IDs match BRIEF.md Part B §B3). Record deviations and blockers here — never diverge silently.

## S0 — Latency spike (GO/NO-GO)

- [x] S0.1 spike script (providers with available keys; skip + record missing — day 0: Anthropic only)
- [x] S0.2 RESULTS.md with verdict (GO/window recommendation)
- [x] **GATE: GO verdict committed**

**Stage note (S0 complete):** `spikes/latency/` is a standalone TS package (no app code, no Ably key). Ran the Anthropic roster (Opus 4.8 / Sonnet 5 / Fable 5), 3 runs × 2 variants (bare/with-digest) × 12 questions = 216 calls. OpenAI + xAI skipped (no keys) and recorded; MCP timing skipped (optional, S6). **Verdict: GO, 20s window** — p95 time-to-answer 5.76s, 100% valid-answer rate. Grounding lifts the `ably-internal` band 83% → 100% (the pre-learning meta-game working, per §A3). Full numbers in [spikes/latency/RESULTS.md](spikes/latency/RESULTS.md). Re-run the script as `OPENAI_API_KEY`/`XAI_API_KEY` arrive.

## S1 — Foundation

- [x] S1.1 pnpm monorepo scaffold
- [x] S1.2 lint/format/test + CI + CONTRIBUTING.md
- [x] S1.3 Ably app setup (persistence, batching on answers namespace + timestamp VERIFY, AIT appends rule) + docs/ABLY-SETUP.md + limits notes
- [x] S1.4 /api/ably-auth JWT + capability matrix + tests
- [~] **GATE: CI green; two tabs pub/sub via issued JWTs** — pub/sub via issued JWTs **PROVEN** (see below); CI-green pending first push/PR (needs Matt's OK — outward action).

**Stage note (S1):** Monorepo (Next 16 / React 19 / Tailwind v4 · core · agent-runner · spikes) with strict TS, ESLint flat, Prettier, Vitest, and GitHub Actions CI (lint · format · typecheck · test). Ably app `YOUR_APP_ID` configured (3 namespaces); batch-timestamp semantics verified empirically (quantized → accept, §B2.1). `/api/ably-auth` issues role-scoped Ably JWTs; capability matrix + JWT signing unit-tested (21 tests). **S1 gate pub/sub proven end-to-end** via `spikes/auth-e2e` against real Ably: host→main broadcast, player→answers fan-in, and player-publish-to-main correctly denied (40160). Full local gate green. The only outstanding gate item is observing CI green on GitHub, which requires pushing the branch (awaiting go-ahead).

## S2 — Core engine

- [x] S2.1 protocol schemas (zod) + types
- [x] S2.2 quiz state machine
- [x] S2.3 scoring algorithms + counterfactual recompute + tests
- [x] S2.4 quizmaster engine (answers, dedupe, window, LiveObjects, recovery)
- [x] **GATE: engine e2e under test incl. 300-answer burst**

**Stage note (S2):** Pure, fully-tested core engine (54 tests): protocol (zod, single source of truth), state machine, scoring + counterfactual (recompute === live invariant proven), and the quizmaster — Ably-agnostic via injected `Broadcaster`/`QuizStore`, answers pushed via `ingest`. Gate met: e2e over a mock transport incl. a 300-answer burst (zero drops/double-counts, correct tallies + standings) and recovery-from-history (completed quiz + in-flight question, correct letter re-derived from published options). Ably wiring of these interfaces lands in S3.

## S3 — Humans-only playable

- [x] S3.1 create flow (paste TSV/CSV, algo picker, links + QR)
- [x] S3.2 lobby (presence roster)
- [x] S3.3 question loop UI (/play, /screen: countdown, tallies, reveal, tug-of-war)
- [x] S3.6 synthetic load test — **PoC target ≤150 players (Matt's scope): 150 distributed players → 450/450 answers, ZERO drops** at realistic timing ([LOAD-RESULTS.md](spikes/quiz-sim/LOAD-RESULTS.md))
- [x] **GATE (PoC scope ≤150): zero dropped answers + recovery passes** — 150 distributed = 450/450 zero-drop; recovery PASSES (S3.5); browser E2E passes (S3.3/S3.4). Full 300 deferred to S5.3 (needs §B2.1 presence-split + tier).

**Stage note (S3 complete, PoC scope):** Humans-only quiz is fully playable end-to-end on real Ably — create → lobby → question loop (countdown, live tallies, reveal, tug-of-war) → podium, plus host/player/screen recovery. Gate scoped by Matt to **≤150 players** for the PoC. Load harness (`spikes/quiz-sim`) proves **150 distributed players answer with zero dropped answers** at realistic human timing (450/450); the ~12% loss in naive runs was two synthetic artifacts (single Node event-loop contention; an unrealistic <3s burst brushing the lone host subscriber's ~50 msg/s delivery cap) — never Ably/app, no `42911`, no sharding needed. Recovery is automated + regression-tested (`recover.ts`, 5/5) and verified in a real browser. Scaling toward 300 (presence-split onto a batched `quiz-lobby` channel + tier bump) is an S5.3/real-event concern, not the PoC.

## S4 — Agents

- [ ] S4.1 agent runner + registry loader
- [ ] S4.2 AIT sessions (presence lifecycle, streamed thinking, quips, deadline budget, supervisor)
- [ ] S4.3 roster of five + ably-digest + study script + cribs
- [ ] S4.4 agent host on Vercel (Fluid, lease, heartbeat, re-trigger) + local runner
- [ ] S4.5 UI: agent chips, thinking drawer, quips
- [ ] S4.6 commentator
- [ ] S4.7 agent dev kit (`agent:new`, `agent:test` local harness, baseline comparison)
- [ ] **GATE: dry run incl. agent-host kill/recovery test + dev-kit 10-minute experience**

## S5 — Polish & quiz-day readiness

- [ ] S5.1 counterfactual "by the way…" panel
- [ ] S5.2 design polish pass (frontend-design skill)
- [ ] S5.3 full dry run (~10 humans + roster + 300 synthetic) + tuning
- [ ] S5.4 README + docs/RUNBOOK.md
- [ ] **GATE: quiz-day definition of done (see brief)**

## S6 — Week 2: MCP + open-source

- [ ] S6.1 fast-model MCP router in runner
- [ ] S6.2 Ably MCP wiring (dev OAuth; prod service account per security team)
- [ ] S6.3 MCP-powered study()
- [ ] S6.4 PR-your-own-agent docs + CI (dev-kit harness)
- [ ] S6.5 open-source pass (Ably Labs)

## Deviations

- **S1.3 (channel naming):** answers/agent channels renamed `quiz:{id}:answers` → `quiz-answers:{id}` and `quiz:{id}:agent:{slug}` → `quiz-agent:{id}:{slug}`. Rationale: Ably namespaces match the first colon-segment only, so per-namespace rules (batching on answers, appends on agent sessions, neither on main) require distinct prefixes. Same architecture; encoded in the protocol at S2.1. See [docs/ABLY-SETUP.md](docs/ABLY-SETUP.md).
- **S1.3 (fairness clock):** VERIFIED empirically that under real server-side batching, per-message server timestamps quantize to the batch flush (≈2 distinct timestamps across 20 simultaneous messages), NOT preserved per-message. Decision per §B2.1: accept ≤200ms quantization (uniform → fair); keep batching on `quiz-answers` (needed for the quizmaster's 50 msg/s outbound limit at scale). Tunable to 100ms or off; revisit at S3.6.
- **S3.3 (LiveObjects shape):** quiz state (phase/questionIdx/config/tallies/scoreboard) is stored as root-map JSON values with coalesced writes (`AblyLiveStore`), rather than a nested LiveCounter-per-option + LiveMap-per-player (§B2.3). The host is the sole writer and owns the authoritative counts; whole-value writes with a ~150ms flush keep object-op rate bounded under a burst and the reader still gets live updates. Revisit if a per-key CRDT is needed. LiveObjects requires channel MODES (`object_subscribe`/`object_publish`) to be requested explicitly — centralised in `getMainChannel`.
- **S3.3 (screen role):** `/screen` authenticates as `player` (read-only caps) and reads its header from LiveObjects `config`, so the screen link works from any device without the host key.
- **S3.3 (T₀ race, engine):** answers can reach the quizmaster before the question's server timestamp T₀ is captured from the publish echo. The engine now BUFFERS such answers per question (dedup locked in) and scores them the instant T₀ lands — fixing dropped answers (sim went 11/15 → 15/15). Unit-tested.
- **S3.1 (host storage):** the full quiz definition is stored in `localStorage` (not the brief's `sessionStorage`) so the create tab, `/host`, and `/screen` on the same host machine share it and it survives a refresh for recovery. Still host-machine-only; never shared. See `apps/web/lib/quiz-storage.ts`.
- **S0:** Spike omits the `temperature` param by default — newer Claude models (Opus 4.8 / Sonnet 5 / Fable 5) reject it (`400 … "temperature is deprecated for this model"`). Providers run at their default sampling; still settable via `SPIKE_TEMPERATURE` for providers that accept it. Carry forward to the S4 agent runner. Bumped `maxTokens` 300 → 400 after one truncated no-answer in a smoke run; full run then hit 100% valid-answer rate.

## Blocked

_(none — the S3-gate scale question is resolved: Matt scoped the PoC to ≤150 players (2026-07-12), and 150 distributed = 450/450 zero-drop is demonstrated. See the S3 stage note + [LOAD-RESULTS.md](spikes/quiz-sim/LOAD-RESULTS.md).)_

## Follow-ups beyond the PoC (toward a real 300-player event, ~S5.3)

- **Presence-split for >250 roster.** The lobby roster caps at 250 members/channel on this tier (`91003`). For 300+, move presence to a dedicated **batched `quiz-lobby:{id}` channel** (§B2.1) — code + an Ably app-config change (new batched namespace) — and confirm/raise the Ably tier. Not needed at ≤150.
- **Answer-channel sharding** (`quiz-answers:{id}:{0..n}`) only if a genuine high-scale burst ever shows `42911` or host-delivery loss — not observed at PoC scale; do not pre-shard.
- **Faithful high-scale load** needs a distributed rig (harness supports it via `PLAYERS_ONLY` + `CLIENT_PREFIX`) and a deployed auth endpoint (the local Next dev server tops out serving a concurrent auth storm from many client processes).

## Deviations (create-flow, from Matt's 2026-07-11 review — landed)

- **Host key removed entirely.** The brief (§A2/§B2.5) gated hosting/agent-spawning behind `HOST_KEY`. Matt's call: over-engineered for this demo — free, resource-limited account, unguessable quiz id, Ably caps the blast radius. `/api/ably-auth` now issues host/agent tokens with no secret; the create host-secret field, `lib/host-secret.ts`, and `HOST_KEY` env/`.env.example` are gone. Roles/clientId prefixes stay. Re-add a gate only if a real deployment needs it.
- **Question grid → `react-datasheet-grid`** (lightweight dedicated library, dark-themed) instead of a custom grid — native spreadsheet copy/paste.
- **Create UX:** quiz-wide "default time per question"; Time/Category marked optional ("leave blank for default"; Category = a screen label). Scoring blurbs reframed as "pick this if…".
- **Bug fixed (host clientId):** `connect()` set the client's clientId from a first token fetch while `authCallback` fetched again — for the host (no clientId sent) the server randomised each fetch → Ably's "invalid clientId for credentials". Now a stable clientId base is pinned up front. `spikes/quiz-sim` host now connects via the real `connect()` so this is regression-tested; verified in a real browser end-to-end (host connects, 5 live players, both questions fan-in, lock/reveal cycle).
- **Dev-only "load samples" link.** On localhost/`.local`/`.test` hosts only, the create page shows a "load samples" link that fills the grid with 5 ready-made questions, so manual testing doesn't need retyping a quiz each time. Hostname-gated; never rendered in prod.
- **Grid add-row footer dark-themed.** `react-datasheet-grid`'s `.dsg-add-row` shipped as a light strip with black text; overridden to canvas/ink to match the rest of the grid.
- **S3.5 (player/agent `history` capability).** The §B2.5 matrix gave players only `subscribe/presence/object-subscribe` on the main channel. Added `history` (players + agents) so a refreshed player re-derives the in-flight question from control history — the question text is broadcast as control, not held in LiveObjects (§B2.3), so it can't be recovered from object state alone. Host already has `*`. Capability tests updated.
- **S3.5 (recovery wiring).** `useHostQuiz` now reads control+answer history on connect and calls `Quizmaster.recover` when a question was already broadcast (else `init`), buffering live answers until replay completes (engine dedup makes overlap safe). `useQuizState` seeds the in-flight question (+reveal) from control history unless a live control already arrived. Proven end-to-end against real Ably by `spikes/quiz-sim/recover.ts` (host B rebuilt == host A: phase/idx/log/scores; player-token history reconstructs the question; recovered host resumes to podium). Manual browser procedure + all test commands in [docs/TESTING.md](docs/TESTING.md).
- **S3.5 (defensive store writes).** `AblyLiveStore.write` now swallows+warns on failure instead of leaving a rejected fire-and-forget promise — a coalesced flush can race a closing connection (host refresh/unload), which otherwise crashed Node and logged noisily in the browser. The host re-writes whole values on every change, so a dropped best-effort write is recoverable.

## Backlog / follow-ups (from Matt, beyond the original brief)

- **"Open a Google Sheets template" button on `/create`** — one click opens a pre-formatted Google Sheets template with the columns already in place (question, correct, wrong1–3, time_limit_s, category), so authors start from a clean template and paste back into the grid. Deliberately deferred as a separate task (outside the original brief scope). (Matt, 2026-07-11.)
