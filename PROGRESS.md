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
- [ ] S3.4 podium + results
- [ ] S3.5 recovery tests (host + player refresh) + docs/TESTING.md
- [ ] S3.6 synthetic 300-player load test
- [ ] **GATE: full quiz, 5 real browsers + 300 synthetic, zero dropped answers, recovery passes**

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

_(none yet)_

## Deviations (create-flow, from Matt's 2026-07-11 review — pending implementation)

- **Host key removed entirely.** The brief (§A2/§B2.5) gated hosting/agent-spawning behind `HOST_KEY`. Matt's call: over-engineered for this demo — it runs on a free, resource-limited account, the quiz id is effectively unguessable, and we don't care if someone abuses it (Ably caps the blast radius). So `/api/ably-auth` will issue host/agent tokens without any secret; the create page drops the host-secret field; `HOST_KEY` env + `lib/host-secret.ts` go away. Roles/clientId prefixes stay (for capabilities + kind). Re-add a gate only if a real deployment needs it.
- **Question grid → `react-datasheet-grid`.** Replace the custom paste grid with the lightweight dedicated library (Matt prefers not maintaining our own where a good light one exists).

## Backlog / follow-ups (from Matt, beyond the original brief)

- **"Open a Google Sheets template" button on `/create`** — one click opens a pre-formatted Google Sheets template with the columns already in place (question, correct, wrong1–3, time_limit_s, category), so authors start from a clean template and paste back into the grid. Deliberately deferred as a separate task (outside the original brief scope). (Matt, 2026-07-11.)
