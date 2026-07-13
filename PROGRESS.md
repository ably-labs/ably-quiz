# Build progress — Carbon vs Silicon

> Maintained by the build agent. Check tasks off as they land (task IDs match BRIEF.md Part B §B3). Record deviations and blockers here — never diverge silently.

## S0 — Latency spike (GO/NO-GO)

- [x] S0.1 spike script (providers with available keys; skip + record missing — day 0: Anthropic only)
- [x] S0.2 RESULTS.md with verdict (GO/window recommendation)
- [x] **GATE: GO verdict committed**

**Stage note (S0 complete):** `spikes/latency/` is a standalone TS package (no app code, no Ably key). Ran the Anthropic roster (Opus 4.8 / Sonnet 5 / Fable 5), 3 runs × 2 variants (bare/with-digest) × 12 questions = 216 calls. OpenAI + xAI skipped (no keys) and recorded; MCP timing skipped (optional, S6). **Verdict: GO, 20s window** — p95 time-to-answer 5.76s, 100% valid-answer rate. Grounding lifts the `ably-internal` band 83% → 100% (the pre-learning meta-game working, per §A3). Full numbers in [spikes/latency/RESULTS.md](spikes/latency/RESULTS.md). **Re-run 2026-07-12 with xAI added — verdict holds (GO, 20s; p95 5.95s):** the `.env.local` OpenAI/xAI vars were placeholders, but a real `XAI_API_KEY` lives in Matt's LiteLLM env (`~/.provider-keys.env`) — sourced at run time (see spike README). `matt-grok` (`grok-4.20-0309-non-reasoning`, verified via `api.x.ai/v1/models`) is the **fastest model** (p50 0.9s, p95 1.32s, 100% valid+accurate). **OpenAI remains unavailable** — not configured anywhere on this machine (LiteLLM fronts xAI/Anthropic/Google, no OpenAI), so `matt-gpt` stays skipped until an `OPENAI_API_KEY` is provided. One no-answer (99.7% valid): a Sonnet quip with unescaped quotes broke strict-JSON extraction — carry to the S4 runner's JSON enforcement.

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

- [x] S4.1 agent runner + registry loader
- [x] S4.2 AIT sessions (presence lifecycle, streamed thinking, quips, deadline budget, supervisor)
- [x] S4.3 roster of **five** (`matt-gpt` added 2026-07-13 once an OpenAI key landed) + ably-digest + study script + cribs
- [ ] S4.4 **on-demand agents** (create-time checklist → declarative roster; host-triggered in-app `/api/agent-turn`; presence=thinking-indicator). Redesigned — see "S4.4 + S6 redesign" below. `agents:start` kept as dev harness.
- [x] S4.5 UI: agent chips (roster, Slice A) + on-screen thinking wall + quips on `/screen` (2026-07-14)
- [x] S4.6 commentator — Fable streams a ~150-word verdict to `/screen` on `analysis` (2026-07-14)
- [ ] S4.7 agent dev kit (`agent:new`, `agent:test` local harness, baseline comparison)
- [ ] **GATE: dry run incl. agent-host kill/recovery test + dev-kit 10-minute experience**

**Stage note (S4.2):** `matt-fable` joins a live quiz end-to-end on real Ably. The
tested S4.1 core (`answerQuestion`) is reused unchanged; S4.2 adds `live-agent.ts`
(the only I/O module) + `think-stream.ts` (pure delta→`UIMessageChunk` mapper, 7
unit tests) + a `cli.ts` entrypoint (`pnpm agents:start --quiz <id> [--agent] [--base]`),
plus `agents/matt-fable/agent.json`. The agent wears two presences — roster on
`quiz:{id}` (`{name,emoji,model,owner}`, clientId `a:{slug}` → the AGENTS column)
and AIT status on `quiz-agent:{id}:{slug}` (`joining→idle→thinking→answered`).
Thinking streams over AIT via the **self-invocation workaround** (SDK pinned
`0.5.0`, `@ably/ai-transport/vercel`): a co-located `ClientSession` publishes the
question as the triggering user turn, converted in-process to an Invocation and
piped through the `AgentSession` run. **Answers stay on the plain fan-in**
(`quiz-answers:{id}`, `{idx,choice,confidence?}`), same clock/contract as humans.
Deadline budget = the runner's existing `limitMs − 2000` abort+force-guess;
supervisor = per-question and per-agent try/catch (one agent's failure never
stalls the quiz or the others — Fluid's error isolation on Vercel is S4.4).
**Verified live vs app `YOUR_APP_ID`:** roster showed `a:matt-fable <agent>`; both
answers landed on the fan-in (`C✓@5465ms`, `C✓@5546ms`, score 1724, `/screen`
tally + tug-of-war confirmed); the AIT channel materialized 2 full runs
(`ai-input`×2 self-triggers · `ai-run-start`/`ai-step-start`/`ai-output`/`ai-step-end`/`ai-run-end`),
the streamed think-aloud correctly clipped at the answer JSON (e.g. _"From the
Latin aurum — gold's classical name…"_). The five-agent roster + shared digest +
study script is S4.3; the on-screen thinking drawer is S4.5.

**Stage note (S4.3):** The field is now **four** — `matt-opus` (claude-opus-4-8),
`matt-sonnet` (claude-sonnet-5), `matt-fable` (claude-fable-5), `matt-grok`
(grok-4.20-0309-non-reasoning). `matt-gpt` (OpenAI) is deferred — no `OPENAI_API_KEY`
on the machine — and drops in later by adding one folder + key. Grounding is two
layers: the hand-curated shared **`packages/core/src/ably-digest.md`** (baseline,
verified vs llms.txt 2026-07-13) injected into every agent, plus each agent's
committed **`crib.md`** from `pnpm agents:study`. Study is a named strategy in
agent.json (`"study": "ably-docs"`) → `ablyDocsStudy` scrapes `ably.com/llms.txt`,
keeps the product/concept entries (drops pricing/getting-started noise), and
product entries are sorted to the front so all six products (incl. AI Transport)
are covered before the 50-entry cap. Custom per-agent code studies (`agent.ts`
`study(ctx)`) are deferred to the S4.7 dev kit. Deviation: the registry now
tolerates a declared-but-missing `crib.md` (loads the agent without it) — required
so `agents:study` can run before the cribs exist. To run the field live, source
the real xAI key for `matt-grok` (`~/.provider-keys.env`); the
three Claudes need only `ANTHROPIC_API_KEY`.

## S4.4 + S6 redesign (agreed with Matt, 2026-07-13) — on-demand agents + MCP MCP

> Supersedes the BRIEF's S4.4 ("agent host on Vercel: Fluid, lease, heartbeat, re-trigger")
> and S6.2 ("prod service account"). Recorded here as the authoritative design per §B0
> (never diverge silently). Rationale + code references below so the build doesn't re-derive it.

### On-demand agents (S4.4, rewritten)

Agents are **not a long-lived process**. The persistent `pnpm agents:start` runner (S4.2) is
retained only as a dev/local harness; the real model is **per-question, request-based invocation
inside the running app** — no separate process, no Fluid lease/heartbeat/re-trigger to keep alive.

- **Roster is declarative, not presence.** At create time the host sees an **agent checklist**
  (all four checked by default, uncheck to exclude); the chosen set is written into quiz config
  (LiveObjects/`StoredQuiz`). The AGENTS column reads that — an agent is "present" because it's
  *declared*, and is always assumed ready for the next question.
- **Presence = a transient "thinking/working" indicator only** (optional), shown while a turn runs
  — not persistent membership. (Matt: "present for an agent in this model is really … thinking and working.")
- **Trigger = host, in-app.** When the host broadcasts a question it POSTs `/api/agent-turn` for
  each active agent. That handler runs the existing tested answer core (`runner.ts` `answerQuestion`
  → build prompt from persona + crib + digest → one model call), publishes to the same answer
  fan-in humans use (`quiz-answers:{id}`), streams thinking via AIT for its ~6s life, and returns.
  No Ably integration-rule / webhook (rejected as overcomplication). Per-turn try/catch = isolation.
- **No cold-start concern** — it's a request handler in the already-warm app, not an idle serverless fn.
- Scoring/reveal/tug-of-war unchanged — the fan-in is already decoupled from presence/process, which
  is what makes this a drop-in. (See the S4.3 auto-lock fix: host gates on the per-idx answer count.)

**Build status (S4.4) — Slices A + B landed & verified live (2026-07-14):**
- **Slice A** (declarative roster): `GET /api/agents` lists the registry; create-time agent checklist
  (all on by default) → `config.agents` (`AgentRosterEntry[]`) flows through LiveObjects to host/screen/play.
- **Slice B** (on-demand invocation): `POST /api/agent-turn` runs one agent's turn (persona + crib + digest
  → `answerQuestion`) and publishes to `quiz-answers:{id}` as `a:{slug}` via Ably REST (master key; server is
  the trusted authority — no persistent connection, no AIT). `useHostQuiz` fires one per declared agent on each
  question broadcast, seeds declared display names (scoreboard shows "Matt GPT" without presence), and the
  auto-lock target is now **humans present + declared agents** (union with any present agent slugs, so a
  co-hosted `agents:start` isn't double-counted). Host "X of Y answered" uses the per-idx count / expected count.
- **Verified live, NO runner process:** 5 declared agents shown on host; Start fired 5 turns; Q1 & Q2 each
  `5 of 5` answered + auto-locked; podium scored all five by name (Grok › GPT › Opus › Sonnet › Fable). Direct
  `/api/agent-turn` tests: xAI/OpenAI/Anthropic all answer correctly, grounded (AIT question), HTTP 200.
- **Slice C — on-screen thinking (S4.5): LANDED (2026-07-14).** `/api/agent-turn` streams the think-aloud
  (throttled ~350ms) to `quiz-agent:{id}:{slug}` and a final `answered` with the quip; a new `useAgentThinking`
  hook subscribes per declared agent and `<AgentThinkingWall>` renders it on `/screen` (thinking→answered per
  card, reset per question). Player capability gained `subscribe`+`history` on `quiz-agent:{id}:*` (read-only).
  Typed `agentThinkingSchema` + parser. Verified live: all 5 agents' reasoning + quips render on `/screen`
  across questions. NB streamed via Ably REST from the stateless turn — no AIT self-invocation needed here.
- **Remaining:** the MCP MCP grounding (below, allowlist finalized). Prod hardening: a worst-case ~18s
  turn can exceed a Vercel serverless timeout — address when deploying.

### MCP MCP grounding (S6, rewritten)

Optional live grounding: agents query **MCP** (the org-knowledge MCP) at question time. Auth is
**per-quiz-session host OAuth, client-side only** — the Janus model applied to the quiz. No server-stored
credential (a stored key is an attack surface — Matt's call; drops the BRIEF's service-account path even
though a client_credentials M2M path exists in MCP).

Flow:
1. Quiz **DCR-registers** once as an OAuth client of `ably-core-mcp` (public client + PKCE).
2. Host clicks **"Authenticate agents"** → browser OAuth → **Okta SSO** → 1h access token held in the
   **quiz controller (browser session)**, never persisted server-side and **never logged**. Until then,
   agents run ungrounded (or are disabled — host's choice).
3. Per agent-turn the browser passes the token with the request; `/api/agent-turn` opens an MCP
   `/mcp` connection with that token **+ `?allowedTools=<read-only set>`**, agent uses
   `searchAblyTools`/`callTool`/`getContextDetail`, and the handler **scrubs the token from logs +
   drops it after the response** (request-lifecycle only).
4. **Read-only enforcement is at the MCP level** (where it belongs): the `?allowedTools=` session
   allowlist + Okta-group role scoping, backed by an injected system instruction ("only read; only
   public/company-shared resources; make the conservative call") as belt-and-braces.
5. Token dies at quiz end; 1h TTL is the backstop.

### MCP facts (verified in `~/Projects/ably/ably-os`, 2026-07-13)

- Cloudflare-Worker MCP (`@cloudflare/workers-oauth-provider@0.2.2`), **DCR open** — `/authorize` gates
  only on Okta SSO + `mcp_*` groups, not a client allowlist (`mcp/okta-handler.ts:35`); `/register`,
  `/authorize`, `/token` wired (`mcp/index.ts:1835`). Access token TTL **3600s**.
- Endpoints: base `https://your-mcp-server.example.com` (this is the **prod** target — build
  against it per Matt), MCP on `/mcp` (streamable-http) or `/sse`; dev is `…-dev.example.com`.
- `allowedTools` allowlist is plumbed authorize→props→session (`mcp/okta-handler.ts:84,269`; prop at
  `mcp/index.ts:142`). Slim mode (default) = 5 meta-tools; `?mode=full` = all ~150.
- Deferred: verify a live DCR registration + confirm the exact `allowedTools` enforcement point in
  `callTool`, and whether `ToolMetadata` carries a read/write flag (auto-derive the allowlist vs curate).

### Read-only `allowedTools` allowlist — FINALIZED with Matt (2026-07-14)

Curated from the live registry (`ably-os/packages/context/mcp-tools-reference/full.md`, 273 entries),
classified read vs write by verified tool description. **61 read-only tools**, passed as
`?allowedTools=<comma-joined>` on the `/mcp` connection. This is the source of truth for the build.

- **Plumbing (7):** `searchAblyTools`, `callTool`, `getToolCategories`, `getContext`, `getContextDetail`, `listAllContexts`, `getCurrentDate`
- **Skills (3):** `skillList`, `skillSearch`, `skillGet`
- **Wiki (9):** `wikiSearchPages`, `wikiSearchUsingCql`, `wikiGetPage`, `wikiGetPagesInSpace`, `wikiGetSpaces`, `wikiGetBlogPost`, `wikiGetPageAncestors`, `wikiGetLabels`, `wikiContentInsights`
- **GitHub (12):** `githubGetFileContents`, `githubGetRepository`, `githubGetIssue`, `githubGetCommit`, `githubListAblyRepositories`, `githubSearchAblyRepositories`, `githubSmartSearch`, `githubListBranches`, `githubListTags`, `githubListWorkflowRuns`, `githubGetWorkflowRun`, `githubAnalyze`
- **Helpdesk (2):** `helpdeskGetConversation`, `helpdeskGetConversations`
- **Web fetch (3):** `webFetchAI`, `webFetchBrowser`, `webFetchScrape`
- **Chat (5):** `chatListChannels`, `chatFindAndAnalyze`, `chatDiscoverThemes`, `chatChannelActivity`, `chatAnalyzeThread`
- **Tracker (6):** `trackerGetIssue`, `trackerSearchIssues`, `trackerListProjects`, `trackerListBoards`, `trackerListStatuses`, `trackerCommonQueries`
- **Google Workspace, reads only (14):** `googleDocsRead`, `googleDocsAnalyze`, `googleDocsActivity`, `googleDriveRead`, `googleDriveAnalyze`, `googleDriveExcelAnalyze`, `googleDriveJSONAnalyze`, `googleDrivePDFAnalyze`, `googleSheetsRead`, `googleSheetsAnalyze`, `googleSlidesRead`, `googleSlidesAnalyze`, `googleSlidesSummary`, `googleSlidesActivity`

**Excluded (with reason):** all writes/mutations (`*Create/Update/Add/Send/Move/Transition/Delete/Manage/Write/Chart/Format/Upload/Revoke/Enable/Reload`); **Gong** + **HubSpot** (customer-confidential/PII, even reads); **Xero/Stripe** (finance); **BambooHR/On-Call** (HR/personal); **Gmail/Calendar** + all GSuite writers; **Metabase/Snowflake/usage/GA/Peec/Semrush/Dashboards/Fivetran** (BI, not knowledge); **Sentry** (ops); **LinkedIn/Twitter/Reddit/YouTube/Octolens** (external social); admin/identity (`revoke*`, `*OAuthStatus`, `userInfo`, `chatLookupUser`, `wikiGetUserInfo`); misc (`figma*`, `rebrandly*`, `devtoArticle`, `brand*`, `worldCup*`, `submitFeedback`). Note `googleDriveManage` excluded because it can **share** (change ACLs). Belt-and-braces: an injected system instruction ("reads only; only clearly public/company-shared resources").

### Build status (S6 grounding) — plumbing landed, live grounding pending Matt's Okta (2026-07-14)

- **Model-side** (`9d80b98`): `lib/ably-os.ts` (Worker URL, 61-tool allowlist, connector tools = callTool
  + getContext only, injected catalog + reads-only instructions); `providers.ts` attaches the
  Anthropic beta MCP connector (`mcp-client-2025-11-20`) on grounded turns; `runner.ts`/`api/agent-turn`
  thread `grounding` + `mcp`, grounding a turn only when a token is present AND the agent is Anthropic
  (grok/gpt run ungrounded). Dormant + non-breaking until a token flows.
- **Host OAuth** (`7fe9db4`): `/api/mcp/register` (discovery + DCR proxy), `/api/mcp/token` (PKCE exchange
  proxy, SSRF-guarded), `useMcpAuth` (DCR → PKCE → Okta redirect → callback → token in sessionStorage),
  `/host` "Authenticate agents" banner. Token browser-only, passed per turn, never stored/logged.
- **LIVE-VERIFIED end-to-end (2026-07-14, Matt):** host Okta login → token → grounded Anthropic agents
  (opus/sonnet/fable) answer via the connector against the real MCP Worker; grok/gpt play ungrounded.
  Fixup found on the first run (`faa5b8f`): the connector shape matches the **2025-04-04** beta, not the
  2025-11-20 one (which needs an `mcp_toolset` in `tools`) — the wrong pin 400'd every grounded turn.
  DCR/PKCE/redirect-URI-with-`?quiz=`/token-exchange all worked unchanged.
- **Still worth watching:** grounded-turn latency vs the ~18s deadline (a real lookup + answer is slower than
  ungrounded) — tune (cap to one fast tool call / adjust deadline) if grounded agents start missing the window.

### Follow-ups (not quiz blockers)

- **MCP `?readOnly=true` mode** — a server-side read-only filter by tool metadata so new read tools
  appear automatically (the `allowedTools` allowlist doesn't auto-update). Small MCP PR; Matt's idea.
- More general (non-Okta) MCP endpoints later — for now Okta-gating is fine (internal quiz; anyone can
  fork and point at their own MCP endpoint + agents — nothing exposed, it's just an env var).

## S5 — Polish & quiz-day readiness

- [ ] S5.1 counterfactual "by the way…" panel
- [ ] S5.2 design polish pass (frontend-design skill)
- [ ] S5.3 full dry run (~10 humans + roster + 300 synthetic) + tuning
- [ ] S5.4 README + docs/RUNBOOK.md
- [ ] **GATE: quiz-day definition of done (see brief)**

## S6 — Week 2: MCP + open-source

- [ ] S6.1 fast-model MCP router in the agent-turn handler
- [x] S6.2 **MCP MCP wiring** — host OAuth (DCR + Okta), client-side per-session token, `?allowedTools=` read-only, no service account. **LIVE-VERIFIED 2026-07-14** (see build-status note above). Redesigned — see "S4.4 + S6 redesign" above.
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
- **S4.2 (agent-runner deps):** added `@ably/ai-transport@0.5.0` (pinned exact — the self-invocation workaround is validated only against this version, per [docs/AIT-DX-FINDINGS.md](docs/AIT-DX-FINDINGS.md)), `ably`, `ai@^6` (peer of the AIT vercel entry; supplies the `UIMessageChunk` types), plus `dotenv` + `tsx` for the CLI. The live wiring (`live-agent.ts`, `cli.ts`) is deliberately **not** re-exported from the package index — `apps/web` transpiles this package (S4.5 UI) and must not bundle the server-side `@ably/ai-transport/vercel` + `ably` runtime; only the pure `think-stream` (type-only `ai` import) is exported.
- **S4.2 (env for `pnpm dev`):** `next dev` loads `.env.local` from its own cwd (`apps/web`), not the repo root, so `/api/ably-auth` returned `500 ABLY_API_KEY not configured`. Added a **gitignored symlink `apps/web/.env.local → ../../.env.local`** so the dev server sees the key (matches what [docs/TESTING.md](docs/TESTING.md) already assumes). Untracked/local-only; not part of the commit.
- **S4.2 (AIT wire shape, informational):** the agent-channel history materializes the full run lifecycle (`ai-input` self-trigger · `ai-run-start` · `ai-step-start` · `ai-output` · `ai-step-end` · `ai-run-end`). The streamed think-aloud rides `ai-output` messages (append-rolled — some are empty boundary appends). No decoding needed for S4.2 (screens use the client-side `useView` in S4.5); noted so the inspector work in S4.5 knows the shape.

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

## Enhancements (from Matt's 2026-07-13 playtest — landed)

- **`matt-gpt` joins the field (OpenAI, `gpt-5.3-chat-latest`).** Added once an `OPENAI_API_KEY` landed — one folder (`agents/matt-gpt/`) + committed crib, per the S4.3 "drops in later" design. Model chosen live from the OpenAI models API (a `*-chat-latest` non-reasoning flagship — fast, strong, and compatible with the runner's streaming `chat.completions` path); verified live end-to-end (connected, answered q0 → correct in 2.8s). **Deviation (`providers.ts`):** OpenAI's current models reject `max_tokens` and require `max_completion_tokens`, so `streamOpenAiCompatible` now branches — `max_completion_tokens` for OpenAI, `max_tokens` for xAI (grok, unchanged). Env: the real xAI key lives in `~/.provider-keys.env` (the `.env.local` value was a placeholder); the pasted `OPENAI_API_KEY` had the template's trailing `# later — Matt GPT` comment glued on — both fixed in the gitignored `.env.local`, never committed.


- **S4.3 live 4-agent smoke — PASSED.** The full field (`matt-opus`/`sonnet`/`fable`/`grok`) ran live against real Ably end-to-end: all four join the roster, receive each question, think, answer on the humans' fan-in, and score to podium. Grounding confirmed (all four correctly answered the Ably-internal AIT question); model speed ordering matches the S0 spike (grok ~1s → fable ~6s). Run via `pnpm agents:start --quiz <id> --base http://localhost:3000` with the real xAI key sourced from `~/.provider-keys.env` into the runner env (dotenv doesn't override an already-set var, so it wins over the `.env.local` placeholder). This was S4.3's last open verification item.
- **Auto-lock race fixed (host).** The smoke surfaced an intermittent bug: on a question transition the host auto-locked after only the *fastest* agent answered, dropping the slower three (they scored 0 that question). Root cause in `useHostQuiz`: the auto-lock "everyone answered" test read the LiveObjects scoreboard's `answered` flags, which lag a transition — 3 stale-`true` from the previous question + the fast answerer tripped `>= presentCount`. Fixed by gating on the engine's authoritative per-idx answer count (`getAnswerLog().filter(e => e.idx === openIdx)`, surfaced through `answersIn`) instead of the lag-prone flag. Regression test in `quizmaster.test.ts` locks the per-idx-isolation invariant; re-run smoke confirmed all 5 questions counted 4/4 across every transition.
- **Player countdown + reveal distribution (S3.3).** The player `/play` view was bare: no countdown while answering and a text-only reveal. It already received the question deadline and live tallies through `useQuizState` — now it renders them, reusing the screen's components: a server-timestamp-anchored `<Countdown>` during "asking", and a `<TallyBars>` distribution on reveal ("what everyone picked") with the correct answer marked and the player's own pick ringed + tagged "you". `TallyBars` gained an optional `picked` prop for the you-marker; `/screen` passes nothing so it's unchanged. Pure presentation over existing state; verified live against real Ably (join → wrong answer → reveal). Broader player restyle stays in the S5.2 polish pass.

## Backlog / follow-ups (from Matt, beyond the original brief)

- **"Open a Google Sheets template" button on `/create`** — one click opens a pre-formatted Google Sheets template with the columns already in place (question, correct, wrong1–3, time_limit_s, category), so authors start from a clean template and paste back into the grid. Deliberately deferred as a separate task (outside the original brief scope). (Matt, 2026-07-11.)
