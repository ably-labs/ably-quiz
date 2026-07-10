# Carbon vs Silicon — the Ably Quiz

**A live, company-wide quiz where humans and AI agents compete head-to-head — built entirely on Ably, with agents as first-class contestants over AI Transport.**

Owner: Matt O'Riordan · 2026-07-10 · Status: brief approved, build starting · Target: playable next week

This is ONE file in two parts:

- **Part A — The brief (read this, human)**: concept, locked decisions, open items.
- **Part B — Implementation brief (execute this, build agent)**: architecture spec, coding rules, sequenced stages with acceptance criteria. Written to be executed stage-by-stage by a capable agent (Opus-class) without needing the context of the conversations that produced it.

---
---

# Part A — The brief

## A1. Concept

A Kahoot-style live quiz for all-hands (~80 people, engineered for **hundreds**). The host pastes questions from a spreadsheet template, gets a join link + QR, and runs the quiz on a big screen. Players answer on their phones. Scores are based on **accuracy + speed**. The scoreboard always shows **Humans vs Agents**, best human, and best agent.

The twist: **AI agents are contestants, not features.** Each agent is self-contained — its own process identity, own model, own personality — joins the same lobby, receives the same question broadcast, answers under the same server-side clock. No head starts, no special treatment. Truly *carbon versus silicon*: humans are on the honour system (no gating; "we trust you not to use AI").

The meta-game: agents win or lose on **how well they're engineered** — their pre-learning (context they build for themselves before the quiz), their grounding (MCP access to company knowledge), their latency budgets. Matt ships the first roster (same logic, five different models). The week after, anyone at Ably can **PR their own agent** into the registry and it runs automatically. That's the real competition.

Why beyond fun:
- **Dogfooding AI Transport** — agents live on AIT sessions (presence, token streaming, runs, durable state). Real usage → real DX findings.
- **Open-source demo with a hook** — "point it at your company's MCP and play against your company's knowledge base."
- **Zero-backend story** — no database. Ably is the entire backend: channels for transport, presence for the lobby, LiveObjects for state, history for the audit log. Vercel serves the UI, auth tokens, and hosts the agents.

## A2. Locked decisions

| Decision | Choice |
|---|---|
| Name | **Carbon vs Silicon** (subtitle: *the Ably Quiz*). Repo stays `ably-quiz`; future home Ably Labs — ignore until open-source pass |
| Scoring | Pure pluggable functions, chosen at quiz creation, **shown in the UI**. Default `classic`, 20s window — pending spike results |
| Counterfactual scores | End screen has a geeky "*by the way…*" toggle: recomputes the podium under every other algorithm — "under `fastest-finger`, the winner would have been…" |
| Agent thinking | **Visible.** Each agent streams its reasoning live over its AIT session; anyone can watch it live or inspect it historically per question. This is a headline feature, not a debug view |
| Agent naming | Roster named "Matt Opus", "Matt Sonnet", … after their builder. Ably has many Matts — every agent chip shows **"built by Matt O'Riordan"** (owner metadata is mandatory and displayed) |
| Humans | Un-gated, honour system. Phones are the controller anyway |
| Agents runtime | **On the web server (Vercel)** — verified feasible: Fluid compute is default-on, Node functions run up to 1800s (`maxDuration`, beta) — a full quiz fits in one invocation, and AIT session durability makes restarts survivable. Registry-driven: PR an agent folder → it runs. Local runner for dev |
| Agent trick | **Pre-learning**: agents may run a `study()` phase before the quiz (scour docs/Wiki/data via MCP or scripts) and build their own committed crib sheet, injected at answer time. Plus fast-model tool routing at question time (week 2). Engineering the agent IS the game |
| MCP auth | Dev/study: Matt's OAuth, locally. Production (live quiz on Vercel): **service account — Matt asks the security team Monday** (draft ask in §A4). Do not block on this; prompt-grounding ships first |
| Go/no-go | **Spike S0 before any app code**: measure end-to-end agent answer latency. If a grounded agent can't reliably answer inside ~20s (p95 ≤ 10s target), we rethink before building |

## A3. The go/no-go question

*"Would an agent even score on useful questions, or will it always lose / always time out?"*

Expectation to validate: a single multiple-choice answer with a strict JSON schema is a small completion — frontier models typically land at 1–4s end-to-end, well inside a 20s window, even with a ≤2-sentence visible think-aloud. The risk isn't speed on general knowledge — it's (a) MCP tool-call latency (5–15s) when grounding live, and (b) accuracy on Ably-internal questions ("what's our thematic focus?") where un-grounded models will guess and well-briefed humans will be both faster and right. Which is exactly the game. Spike S0 (Part B) measures all of it on day 0 and produces a written verdict with the recommended question window.

## A4. Open items (humans)

1. **Matt → security team (Monday):** draft ask —
   > We're building an internal quiz where AI agents answer questions grounded via the Ably MCP (and it becomes an open-source "quiz your company MCP" demo). For the production deployment (Vercel-hosted agents) we need non-interactive auth: a service account / machine credential for the Ably MCP with read-only scopes (docs, Wiki search). Can you send instructions for the supported way to do this — or tell us what's missing so we can request it properly? Dev will use my personal OAuth locally in the meantime.
2. **Spike verdict (S0)** → confirms the 20s window or adjusts it.
3. Question author: someone who is NOT Matt writes the quiz questions (agent-author separation). Recruit this week.

---
---

# Part B — Implementation brief (for the build agent)

You are building this repo from this brief. Work through stages **S0 → S5 in order** (S6 is week 2). Do not skip gates. Everything you need is specified here; where the brief says VERIFY, check the live docs rather than trusting training data.

## B0. How to work (non-negotiable)

**Quality gates — before EVERY commit:**
- `pnpm lint && pnpm typecheck && pnpm test` must pass clean.
- Never weaken, skip, or delete a test to make it pass. If a test fails, the code is wrong.
- New logic in `packages/core` (scoring, protocol, engine) requires unit tests in the same commit.

**Commit discipline:**
- Conventional commits, scoped, referencing the task ID from this brief:
  `feat(core): S2.3 scoring algorithms with counterfactual recompute`
  `chore(repo): S1.1 pnpm monorepo scaffold`
- One logical change per commit. No drive-by refactors. The history must read as the build plan executing.
- End of each stage: update `PROGRESS.md` (stage, task checkboxes, deviations, open questions) and commit it. If a stage forces a design deviation from this brief, record it in `PROGRESS.md` under **Deviations** with one-line rationale — don't silently diverge.

**Code style:**
- TypeScript strict everywhere. ESLint (flat config) + Prettier, enforced in CI.
- **Simple and readable beats clever.** This becomes an open-source demo people learn from. Small modules, explicit names, comments only where the *why* isn't obvious.
- Minimal dependencies. Justify every new package in the commit message. Preferred set: `next`, `react`, `tailwindcss`, `framer-motion`, `ably`, `@ably/ai-transport`, `zod`, `ai` (Vercel AI SDK) + provider SDKs, `vitest`, `playwright` (e2e, optional).
- Secrets only via env vars. `.env.local` gitignored; `.env.example` committed and kept current.

**Ably API rule:** before first use of any Ably/AIT API in a stage, fetch `https://ably.com/llms.txt` and the relevant doc page and verify method names/params. If an API isn't in the docs, it doesn't exist — do not invent. Key pages: `/docs/ai-transport/concepts/sessions.md`, `/docs/ai-transport/features/agent-presence.md`, `/docs/ai-transport/features/token-streaming.md`, `/docs/ai-transport/api.md`, `/docs/liveobjects.md`, `/docs/presence-occupancy.md`, `/docs/general/limits`.

## B1. Verified platform facts (as of 2026-07-10)

- **AIT SDK:** `@ably/ai-transport` (core; explicit codec) and `@ably/ai-transport/vercel` (Vercel AI SDK integration; `createClientSession({client, channelName})`, `useChat` transport, `useView` generic hooks). Sessions = durable conversation state materialized from a channel. `ClientSession`/`AgentSession` expose identical `presence` APIs (`enter/update/leave/get/subscribe`) and `session.object` (LiveObjects). Runs manage turn lifecycle; server-side streaming is `await run.pipe(result.toUIMessageStream())`. VERIFY exact package versions at S1.
- **Token streaming:** one logical message per response, built by appends (never message-per-token). Status walks `streaming → complete | cancelled` via `extras.ai.codec`. Append rollup compacts high token rates (default cap ~25 msg/s, `appendRollupWindow` 0–500ms).
- **⚠️ Mandatory app setup:** the **"Message annotations, updates, deletes, and appends"** channel rule MUST be enabled on the namespace(s) carrying AIT sessions — streaming fails without it. Also enable **message persistence** on quiz namespaces (history is our audit log/recovery). One-time, S1.
- **Presence:** requires `clientId` in auth. Ungraceful disconnect removes a member after ~15s. Fine for lobby-scale (~hundreds); VERIFY presence member limits + per-channel msg/s limits at S1 against `/docs/general/limits`.
- **Server-side batching** (`/docs/messages/batch.md`, `/docs/pub-sub/guides/data-streaming.md`): a namespace/channel rule (`batchingEnabled` + `batchingInterval` in ms; Control API or `ably apps rules create --batching-enabled`). Ably holds messages published within the interval and delivers them as ONE batch message (≤200 messages per batch; a batch bills/delivers as a single message). Explicitly recommended for bursts, and it "enables a much higher number of users to be present on a channel". Caveats: no idempotency/dedup inside batches; mutually exclusive with conflation. ⚠️ VERIFY at S1: whether each message inside a batch retains its own server timestamp (our fairness clock) — see §B2.1 for the fallback if not.
- **Vercel Fluid compute:** default-on for new projects. Node runtime, in-function concurrency, error isolation, `waitUntil`. Max duration: 300s default; **800s GA (Pro)**; **1800s beta via per-function `maxDuration`**. Agent host relies on 1800s — VERIFY beta availability on the Ably Vercel team at S4; the lease/restart design below means even 800s works (one mid-quiz handover).
- Internal reference implementation: `~/Projects/Ably/ai-transport-ai-elements-demo`.

## B2. Architecture

```
Vercel (Next.js, Fluid compute)                 Ably (the entire backend)
┌──────────────────────────────┐    ┌────────────────────────────────────────┐
│ apps/web                     │    │ quiz:{id}                     MAIN     │
│  /        create quiz        │    │  · control events (host → all)        │
│  /host    controls           │◄──►│  · presence = lobby roster             │
│  /screen  projector view     │    │  · LiveObjects = phase/scores/tallies  │
│  /play    phone controller   │    ├────────────────────────────────────────┤
│  /api/ably-auth   (JWT)      │    │ quiz:{id}:answers             FAN-IN   │
│  /api/quiz        (create)   │    │  · everyone publishes answers here     │
│  /api/agent-host  (Fluid,    │◄──►│  · ONLY quizmaster subscribes          │
│     maxDuration 1800, runs   │    ├────────────────────────────────────────┤
│     the whole agent registry)│◄──►│ quiz:{id}:agent:{slug}    AIT SESSION  │
└──────────────────────────────┘    │  · per-agent: presence status,         │
   agents/* (registry, PR to add)   │    streamed THINKING, quips, history   │
   packages/core (engine, scoring)  └────────────────────────────────────────┘
   packages/agent-runner
```

### B2.1 Channels & why they're shaped this way

1. **`quiz:{id}` (main)** — control events, lobby presence, LiveObjects. Players: `subscribe` + `presence` only.
2. **`quiz:{id}:answers` (fan-in, server-side batched)** — answers published here, ONLY the quizmaster subscribes. Rationale: answers on the main channel would fan out N×N (300 players → ~90k deliveries per question); fan-in keeps it at N. Additionally enable **server-side batching** on this namespace (`batchingInterval` ~200ms): a 300-answer burst reaches the quizmaster as a handful of batch messages instead of 300 deliveries — burst absorption + cost reduction. Players get publish-only capability here; publisher clients set `echoMessages: false`. With persistence enabled, this channel's history IS the durable answer log (used for recovery and counterfactual scoring).
   ⚠️ **Timing under batching (VERIFY at S1.3):** if individual messages inside a batch retain their own server timestamps → use them, done. If a batch carries only one timestamp → accept quantization: `elapsedMs` is accurate to ±`batchingInterval` (200ms on a 20s window, uniform for everyone — fair, and worst case we shrink the interval to 100ms or drop batching; the fan-in design alone already avoids the N² problem). Note batching compacts *delivery*, not *inbound publish* — per-channel inbound rate limits still apply; measure at S3.6, shard `:answers:{0..n}` only if numbers demand.
   **Do NOT enable batching on the main channel** — control events (question broadcast) must not absorb interval delay. If the S3.6 load test shows presence join/leave bursts straining the main channel at 300 players, move presence to a dedicated batched `quiz:{id}:lobby` channel (batching explicitly raises presence capacity) — roster UI happily tolerates 200ms.
3. **`quiz:{id}:agent:{slug}` (one AIT session per agent)** — the agent's public mind: presence (`joining → idle → thinking → answered`, plus quip/streak data) and **token-streamed thinking** per question. Screens subscribe live; the inspector reads history (rewind/history) for "what was Matt Fable thinking on Q4?". Answers do NOT go here — agents answer on the fan-in channel like everyone else, same clock, same contract.

### B2.2 Timing & fairness (the core mechanic)

- The question `control` message's **Ably server timestamp** is T₀. Each answer message's server timestamp is T₁. `elapsedMs = T₁ − T₀`. One clock for everyone, set by Ably, unfakeable by clients.
- Client countdowns are cosmetic. Quizmaster enforces: first answer per `clientId` per question counts; answers after `limitMs + 250ms` grace score 0.
- Agents receive questions via the same channel event as humans. The agent host must NOT be given the question early (the host UI process and agent host share no state besides Ably).

### B2.3 State & recovery

- **LiveObjects root map** on `quiz:{id}`: `phase` (`lobby|asking|locked|revealed|podium|analysis|done`), `questionIdx`, `config` (scoring algo id, window, counts — NOT the questions themselves), `tallies` (LiveCounter per option, reset each question), `scoreboard` (LiveMap `clientId → {name, kind, score, streak, answered}`).
- Questions are withheld: full quiz definition lives only with the host (sessionStorage + in-memory) and is broadcast one question at a time. Players/agents can only ever see what's been asked.
- **Recovery:** any client (including host) that refreshes re-attaches, hydrates LiveObjects, and resumes. Quizmaster recovers the in-flight question's answers from `:answers` history. Test this explicitly (S3 acceptance).

### B2.4 The quizmaster (scoring authority)

An isomorphic engine in `packages/core` — a pure-ish state machine: `subscribe answers → validate → score → write LiveObjects → advance phase on host command`. v1 runs it in the **host's browser** (projector machine). It must ALSO run under Node unchanged (`pnpm quizmaster --quiz <id>`) — keep the seam clean (no DOM imports in core). Scoring itself is pure functions (§B2.6) — unit-testable without Ably.

### B2.5 Auth

- `/api/ably-auth` issues JWTs (signed with the Ably API key secret; key never leaves the server). Roles via short-lived signed role claims in the request (quiz create returns role tokens embedded in links):
  - **player**: main `subscribe`+`presence`, answers `publish`. `clientId = p:{nanoid}` (nickname in presence data).
  - **host/quizmaster**: full on `quiz:{id}:*`. Gated by `HOST_KEY` env secret at quiz creation.
  - **agent**: its own session channel full, answers `publish`, main `subscribe`+`presence`. `clientId = a:{slug}`.
- `kind` (human/agent) is derived from the `clientId` prefix, which auth controls — an agent can't masquerade as human and vice versa.

### B2.6 Scoring — pluggable + counterfactual

```ts
// packages/core/src/scoring.ts
export type ScoreInput = { correct: boolean; elapsedMs: number; limitMs: number; streak: number };
export type ScoringAlgo = { id: string; label: string; blurb: string; score: (a: ScoreInput) => number };
```

| id | if correct (else 0) | character |
|---|---|---|
| `classic` (default) | `round(1000 × (1 − (elapsed/limit)/2))` | Kahoot's real formula |
| `fastest-finger` | `round(1000 × e^(−2.2 × elapsed/limit))` | speed premium; instant≈1000, buzzer-beater≈110 |
| `steady` | `1000` flat; cumulative time = tiebreak | pure accuracy |
| `streak` (modifier) | any above × `min(1 + 0.1×streak, 1.5)` | optional toggle |

- Selected at creation; **displayed in the lobby and screen footer** ("scoring: classic").
- **Counterfactual panel:** quizmaster keeps the raw answer log `{clientId, idx, choice, correct, elapsedMs}` (recoverable from `:answers` history). At `analysis`, recompute final standings under EVERY algorithm and include in the results payload. End screen gets a small "*by the way…* 📊" toggle: "under `fastest-finger` the winner would have been **Priya**, not **Matt Fable**". Pure recompute — no extra infra. Unit-test that per-algorithm recomputes match live scoring given the same log.

### B2.7 Agents

**Registry contract — `agents/<slug>/`:**

```jsonc
// agent.json (required)
{
  "name": "Matt Fable",                 // display name; convention: <builder first name> + <model>
  "slug": "matt-fable",
  "emoji": "🟣",
  "owner": "Matt O'Riordan <matt@ably.com>",   // REQUIRED — displayed on the chip ("built by …")
  "provider": "anthropic",              // anthropic | openai | xai | google | custom
  "model": "claude-fable-5",
  "tagline": "Tells you a story about why it's right.",
  "personality": "Erudite, playful, quietly competitive.",
  "crib": "crib.md",                    // optional pre-learned context, committed for transparency
  "mcp": { "url": "…", "auth": "service-account" }   // optional, S6
}
// agent.ts (optional) — export study(ctx) and/or answer(question, ctx) to override defaults
```

**Default runner** (`packages/agent-runner`, plain Node, no framework):
1. Connect; enter main-channel presence (`kind:'agent'`, name, emoji, model, owner). Open its AIT session.
2. On `question`: presence → `thinking`; ONE model call that **streams a brief visible think-aloud (≤2 sentences, ~≤120 tokens) and then emits strict JSON** `{choice:'A'|'B'|'C'|'D', confidence:0..1, quip:string≤80}`. Stream the think-aloud over the session (AIT streaming, status header `streaming→complete`); on JSON, publish the answer to `:answers`; presence → `answered` with the quip. Visible thinking = the model's *output*, never provider-internal reasoning traces.
3. Deadline budget: answer must be published by `limitMs − 2000`. If the stream overruns, abort thinking, force-answer with best guess. A crashed/late agent scores 0 and the quiz never waits for it.
4. Grounding: system prompt = base persona + `crib.md` (if present) + the shared Ably digest (`packages/core/src/ably-digest.md`, curated at S4).

**Pre-learning (`study`)** — the meta-game. `pnpm agents:study [--agent slug]` runs each agent's `study(ctx)` before quiz day (locally is fine — Matt's OAuth works there). Output: `agents/<slug>/crib.md`, committed — everyone can read every agent's cram sheet, which is half the fun. Default study: none. Matt's roster ships one shared study script (docs/llms.txt scrape → digest). MCP-powered study (Wiki trawls etc.) lands in S6.

**Agent host on Vercel** (`/api/agent-host`):
- POST `{quizId}` (host-key auth) → Fluid Node function, `maxDuration: 1800`, boots the FULL registry (every valid `agents/*`), runs all agents concurrently for the quiz duration. Fluid gives error isolation (one agent throwing doesn't kill the rest — still wrap each in its own try/catch supervisor).
- **Lease:** holder writes `agentHost: {instanceId, leaseUntil}` to LiveObjects, heartbeats every 20s. On invocation, if an unexpired lease exists → exit (idempotent). Host UI monitors and re-POSTs if the lease lapses (function death or 800s ceiling) → new invocation resumes: re-enter presence, reopen sessions (AIT sessions are durable — this is the recovery story working as designed).
- Local dev: `pnpm agents:start --quiz <id>` runs the same module.

**Roster (all same runner, different models):** `matt-opus` (claude-opus-4-8) · `matt-sonnet` (claude-sonnet-5) · `matt-fable` (claude-fable-5) · `matt-gpt` (latest OpenAI — VERIFY current flagship id at S4) · `matt-grok` (latest xAI — VERIFY).

### B2.8 Question ingestion

Google Sheets template → copy → paste into create screen. Auto-detect TSV (Sheets) or CSV. Columns:
`question, correct, wrong1, wrong2, wrong3, time_limit_s?, category?`
Validate (exactly one correct, 2–4 options, limits 10–60s default 20), preview table, shuffle options **once server-side at broadcast** (same order for everyone). Create → `quizId` (readable slug), host link, join link + QR.

### B2.9 The AI commentator (analysis phase)

At `analysis`, the host triggers a commentator agent (Fable, its own AIT session `quiz:{id}:agent:commentator`): input = full results (standings, per-question accuracy by species, speed distributions, counterfactuals); output = a witty ~150-word breakdown **streamed token-by-token onto the big screen**. The visible token-streaming showcase moment. Same runner infrastructure, different prompt, no answer duty.

### B2.10 UI direction

Modern, confident, projector-first; one dark theme done properly. Near-black canvas, high-contrast type (Geist/Inter, big weights), **Ably orange as the single accent**, subtle glows. No component-library look; Tailwind + Framer Motion only where it earns it (question entrance, tally bars, podium).

- `/screen`: lobby roster (humans column / agents column, live counts) → question + oversized countdown ring + live tally bars (LiveCounter-driven) → reveal (correct + fastest) → scoreboard interstitial with the persistent **Humans ⚡ Agents tug-of-war bar** → podium (staggered, confetti) → commentator streaming + counterfactual toggle.
- `/play` (phone-first): nickname entry → four fat answer buttons → instant lock-in feedback → your score/rank/streak between questions.
- `/host`: deliberately plain — next/lock/reveal/skip, connection + agent-host health, lease status.
- **Agent presence everywhere:** agent chips pulse while `thinking`; speech-bubble quips on reveal; click a chip (screen or spectator) → drawer with its live thinking stream and per-question history (from session history), crib-sheet link, owner ("built by Matt O'Riordan"), model, confidence per answer.
- Accessibility: correct/wrong = icon + colour, never colour alone.
- Invoke the `frontend-design` skill for the S5 polish pass.

### B2.11 Env & config

```
ABLY_API_KEY=            # server only, never NEXT_PUBLIC
HOST_KEY=                # quiz-creation secret
ANTHROPIC_API_KEY=  OPENAI_API_KEY=  XAI_API_KEY=
ABLY_MCP_URL=  ABLY_MCP_AUTH=…      # S6
```
`vercel.json`: fluid on (default), `maxDuration` per agent-host function. Region: closest to the office for the demo.

## B3. Stages

Every task gets its own commit (`<type>(<scope>): <taskId> <summary>`). Every stage ends with a `PROGRESS.md` update. Gates are hard.

### S0 — Latency spike (GO/NO-GO) — no app code
- **S0.1** `spikes/latency/`: standalone TS script. 12 sample questions in three bands: general trivia, Ably public docs facts, Ably-internal-flavoured. For each provider (Anthropic Opus/Sonnet/Fable, OpenAI, xAI): the REAL answer format (streamed ≤2-sentence think-aloud → strict JSON), 3 runs each: measure TTFT, time-to-valid-JSON, accuracy; variants bare / with-digest; optional single-MCP-call timing if credentials exist. **Run only providers whose API keys are present in `.env.local` and skip the rest gracefully, recording skips in RESULTS.md** — day 0 starts with `ANTHROPIC_API_KEY` only (three models is plenty for a verdict); re-run the script as other keys arrive. S0 needs NO Ably key.
- **S0.2** `spikes/latency/RESULTS.md`: table + **verdict**: p95 time-to-answer ≤10s → GO, 20s window · ≤20s → GO, 30s window · else STOP and flag Matt.
- **Gate:** GO verdict committed. This also de-risks: provider SDKs, streaming parsing, JSON schema enforcement — the heart of the agent runner, proven on day 0.

### S1 — Foundation
- **S1.1** pnpm monorepo: `apps/web` (Next.js App Router, TS, Tailwind), `packages/core`, `packages/agent-runner`, `agents/`, `spikes/`.
- **S1.2** ESLint flat + Prettier + `vitest` + CI (GitHub Actions: lint/typecheck/test on PR); `CONTRIBUTING.md` (coding standards + commit conventions, distilled from §B0).
- **S1.3** Ably app setup + `docs/ABLY-SETUP.md`: namespaces `quiz` (persistence ON), `quiz-answers` (persistence + **server-side batching** ON, `batchingInterval` 200ms), and agent-session namespace (persistence + **the AIT appends/annotations rule** ON — streaming fails without it). Empirically VERIFY timestamp semantics inside batches (publish 3 spaced messages within one interval, inspect what the subscriber sees) and record the finding + the §B2.1 fallback decision in `docs/ABLY-SETUP.md`. Record channel-limit numbers from `/docs/general/limits` relevant to 300 players (inbound publish rate especially).
- **S1.4** `/api/ably-auth` JWT with the §B2.5 capability matrix + role tests.
- **Gate:** CI green; two browser tabs subscribe/publish on a `quiz:dev` channel via issued JWTs.

### S2 — Core engine (pure logic, fully tested)
- **S2.1** Protocol: zod schemas + TS types for all control/answer messages and LiveObjects shapes (§B2). Single source of truth in `packages/core`.
- **S2.2** Quiz state machine: `lobby→asking→locked→revealed→(scores)→…→podium→analysis→done`; transitions only via host commands + timer expiry.
- **S2.3** Scoring algorithms + counterfactual recompute + exhaustive unit tests (boundaries: t=0, t=limit, grace window, streak caps; property test: counterfactual(log) === live-scored totals under same algo).
- **S2.4** Quizmaster engine wired to Ably (inject client for testability): subscribe answers, dedupe first-answer-wins, enforce window via server timestamps, write LiveObjects, maintain answer log, recover from history.
- **Gate:** `pnpm test` covers engine end-to-end with a mocked channel; simulated 300-answer burst scores correctly.

### S3 — Humans-only playable
- **S3.1** Create flow: paste TSV/CSV → validate → preview → create (host link, join link, QR); scoring algo picker.
- **S3.2** Lobby: presence roster, humans/agents columns, counts, join QR on `/screen`.
- **S3.3** Question loop UI: `/play` answer buttons + lock-in, `/screen` countdown ring + live tally bars off LiveCounters, reveal, scoreboard interstitial, tug-of-war bar.
- **S3.4** Podium + basic results.
- **S3.5** Recovery: host refresh mid-question resumes exactly (LiveObjects + answers history); player refresh rejoins seamlessly. Explicit test script in `docs/TESTING.md`.
- **S3.6** Synthetic load: script simulating 300 players answering within 3s; verify limits findings from S1.3 (shard `:answers:{0..n}` ONLY if measurements demand it).
- **Gate:** full quiz with 5 real browsers + 300 synthetic players, zero dropped answers, recovery test passes.

### S4 — Agents
- **S4.1** Agent runner per §B2.7 (reuse the proven S0 streaming/JSON code); registry loader validating `agent.json` (zod).
- **S4.2** AIT sessions: presence lifecycle, streamed thinking, quips; deadline budget + supervisor (agent crash ≠ quiz impact).
- **S4.3** Roster of five + shared `ably-digest.md` (curated from public docs) + shared study script → committed cribs.
- **S4.4** Agent host: `/api/agent-host` Fluid function (`maxDuration` 1800 — VERIFY beta; else 800 + handover), lease in LiveObjects, heartbeat, host-UI health + re-trigger. Local `pnpm agents:start`.
- **S4.5** UI: agent chips + pulsing thinking state + quip bubbles; **thinking drawer** (live stream + per-question history + crib link + owner).
- **S4.6** Commentator (§B2.9).
- **S4.7 Agent dev kit — make "build your own agent" a 10-minute experience.** This is a first-class deliverable, not tooling polish; the company adoption story depends on it.
  - `pnpm agent:new <slug>` — interactive scaffold: asks name/emoji/provider/model/personality/owner → writes a valid `agents/<slug>/agent.json` (+ commented `agent.ts` stub showing the `study()`/`answer()` override hooks).
  - `pnpm agent:test <slug>` — **local harness, zero Ably setup required**: runs the agent against fixture questions (`packages/agent-runner/fixtures/questions.json`, all three bands) over an in-memory mock of the channel bus; the model call is real (only *their* provider key needed). Terminal output: thinking streamed live, then per-question `answer · correct? · latency · score`, a summary table, and a comparison against a committed baseline ("Matt Sonnet's fixture run") so builders instantly know if they'd beat the house. `--live --quiz <id>` joins a real quiz instead.
  - The SAME harness (schema validation always; model run when keys are present) is the CI check for `agents/*` PRs in S6.4.
  - Acceptance: a fresh clone + one provider key + two commands = a new agent answering fixture questions in under 10 minutes.
- **Gate:** dry-run quiz: 5 agents on Vercel + humans; kill the agent-host function mid-quiz → lease lapses → re-trigger → agents return within ~30s and the quiz never stalls. Plus: S4.7 acceptance demonstrated end-to-end.
- ⚠️ S4 must start no later than mid-week; it's the demo's heart.

### S5 — Polish & quiz-day readiness
- **S5.1** Counterfactual "by the way…" panel.
- **S5.2** Design polish pass (invoke `frontend-design` skill): motion, podium moment, projector legibility at distance, colorblind check.
- **S5.3** Full dry run: ~10 humans + full roster + 300 synthetic; fix everything it exposes; tune window/scoring from real data.
- **S5.4** `README.md` (quickstart, template link, screenshot), `docs/RUNBOOK.md` (quiz-day: env checklist, agent-host trigger, failure playbook: agent host dead / host machine dead / Ably degraded).
- **Gate (definition of done for quiz day):** 100+ players stable · host-refresh recovery proven · agent-crash isolation proven · scoring unit-tested · dry run completed · runbook written.

### S6 — Week 2: MCP + open-source
- **S6.1** MCP grounding in the runner: **fast-model router** (Haiku-class: "answer from crib, or is ONE lookup worth it?") → single MCP call, hard 8s budget → main model answers; fall back to crib when the clock says so.
- **S6.2** Ably MCP wiring: dev = Matt's OAuth (local), prod = service account (per security team's instructions — see Part A4; do not block other S6 work on it).
- **S6.3** MCP-powered `study()` for Matt's roster (Wiki/docs trawl → richer cribs, run locally under OAuth).
- **S6.4** PR-your-own-agent: `docs/AGENTS.md` (quickstart built on the S4.7 dev kit: scaffold → test → PR in three commands; contract, budgets, rules: no early question access, answer via fan-in only, thinking must stream), CI job = the S4.7 harness (schema always; fixture dry-run when keys available).
- **S6.5** Open-source pass: secrets sweep, LICENSE (MIT), screenshots/GIF, "quiz your company's MCP" README hook. Target org: Ably Labs (Matt confirms timing).

## B4. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Per-channel limits (msgs/s, presence members) at 300 players | Measured at S1.3/S3.6 before it matters; fan-in isolation kills the N² rebroadcast problem by design; **server-side batching** on `:answers` absorbs delivery bursts; shard `:answers:{0..n}` only if inbound publish limits demand |
| Batching quantizes answer timestamps | VERIFY empirically at S1.3; worst case ±200ms uniform error on a 20s window (fair), tunable down to 100ms, or drop batching — fan-in alone suffices at ~80 players |
| Agent host exceeds max duration / dies | Lease + heartbeat + re-trigger; AIT sessions durable; proven by the S4 kill test |
| MCP latency blows the answer window | Fast-model router + 8s hard budget + crib fallback; MCP is S6, never on quiz-day critical path |
| Provider latency variance on the night | S0 measured it; deadline budget force-answers at `limit−2s`; agents scoring 0 is a valid, funny outcome |
| AIT SDK is young / APIs move | VERIFY-before-use rule (§B0); pin versions; file DX issues as found — that's a project goal, not a nuisance |
| Host browser as authority | LiveObjects persistence + isomorphic engine seam → headless quizmaster is an hour's move if the dry run scares us |

---

*End of brief. Build agent: start at S0. `PROGRESS.md` is your log; the gates are real.*
