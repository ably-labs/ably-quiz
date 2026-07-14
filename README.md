# Carbon vs Silicon — the Ably Quiz

**A live quiz where your colleagues take on a field of AI agents — same questions, same clock, no database. Built entirely on Ably.**

![Carbon vs Silicon — a brain arm-wrestles a microchip](apps/web/public/hero.webp)

## What it is

A pub quiz for the whole room: humans answer on their phones while a roster of AI
agents answers alongside them, on the same fan-in and the same fairness clock. There
is **no backend database** — Ably is the entire backend (Pub/Sub, Presence,
LiveObjects, and AI Transport). The agents are self-contained contestants that
pre-learn, stream their thinking live, and score on the podium next to the humans —
and **engineering a better agent is half the game**: anyone can PR one into `agents/`.

## How it runs

The whole event lives in one browser tab on the host laptop plus everyone's phones —
five routes, no server state of its own:

- **`/`** — the front door: _Host a quiz_ or _Join with a code_.
- **`/create`** — build the questions grid, pick a scoring algorithm, tick which agents play.
- **`/host`** — the control room: QR + join link, _Open shared screen_, and _Start_. You land here straight after creating.
- **`/screen`** — the projected shared view (the big screen with the QR, live tallies, tug-of-war, podium).
- **`/play?quiz=<id>`** — a player's phone.

Create → land in `/host` → project `/screen` → players scan to `/play` → drive the
question loop → podium + commentator verdict.

## Quickstart

Prereqs: **Node ≥ 20** and **pnpm** (the repo pins `pnpm@10.22.0` via `packageManager`).

```sh
cp .env.example .env.local     # then fill in what you have
pnpm install
pnpm dev                       # builds the agent index, then runs the web app
```

Open **http://localhost:3000**, click _Host a quiz_, build a few questions, and you
land in `/host`. Project `/screen` on the big screen; players scan the QR to `/play`.

Which keys unlock what (missing keys are skipped gracefully — a quiz still runs):

| Key                  | Unlocks                                                                             |
| -------------------- | ---------------------------------------------------------------------------------- |
| `ABLY_API_KEY`       | **Everything realtime.** A humans-only quiz runs with just this key.                |
| `AI_GATEWAY_API_KEY` | The **AI agents** — every provider answers through one [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) key. |
| `ANTHROPIC_API_KEY`  | **Grounded** Anthropic turns (the MCP MCP connector) and `pnpm agents:study`.   |

There is **no host secret** — an unguessable quiz id plus Ably's own capability
matrix are the blast-radius control for this demo.

## Agents

Agents are **on-demand, not a long-lived process**. When the host broadcasts a
question, `/host` POSTs `/api/agent-turn` once per declared agent; the handler runs
that agent's answer core (persona + committed crib + shared Ably digest → one model
call) and publishes to the **same answer fan-in humans use**. While it thinks, its
status shows on the shared screen; at reveal it drops a one-liner quip. (Its
reasoning is deliberately **not** shown on screen mid-question — that would leak the
answer to the room.)

The roster is **declarative**: an agent plays because it's ticked at create time, so
a slow or dead model can never stall the quiz. Optionally, the host authenticates
once via **MCP MCP** (read-only OAuth, per session) so Anthropic agents can look
up Ably knowledge live — agents play fine ungrounded too.

**Build your own and PR it in.** Each `agents/<slug>/` is one contestant:

```
agents/<slug>/
  agent.json   # required — name, slug, emoji, owner, provider, model, persona, …
  crib.md      # optional — pre-learned context, committed for transparency
  agent.ts     # optional — your own study / answer hooks
```

```sh
pnpm agent:new <slug>      # scaffold a new agent
pnpm agent:test <slug>     # dry-run it against fixture questions
```

See **[agents/README.md](agents/README.md)** for the full contract and the
PR-your-own-agent flow.

## Architecture

Ably _is_ the backend — no database, no ORM, no server state store. Three channel
roles, each in its own namespace so they can carry different channel rules:

| Channel                  | Role                                                | Notes                                       |
| ------------------------ | --------------------------------------------------- | ------------------------------------------- |
| `quiz:{id}`              | control events, lobby presence, LiveObjects root    | persisted; batching off (control undelayed) |
| `quiz-answers:{id}`      | fan-in answers — everyone publishes, only the quizmaster subscribes | persisted; server-side batching (200 ms)    |
| `quiz-agent:{id}:{slug}` | one agent's live think-aloud + quip (AI Transport)  | persisted; message appends enabled          |

**LiveObjects** (a root map + counters) holds the live tallies and scoreboard;
channel **history** is the durable audit log, which is what makes recovery and the
end-screen counterfactual possible. On-demand agents are just request handlers in the
already-warm app. Full detail in **[docs/ABLY-SETUP.md](docs/ABLY-SETUP.md)**.

Scoring is **pluggable** — `classic`, `fastest-finger`, and `steady` — and the
end-screen "by the way…" panel recomputes the final standings under **every**
algorithm from the same answer log (`recompute(log)` is proven equal to the live
totals). See `packages/core/src/scoring.ts`.

Monorepo layout:

```
apps/web             Next.js 16 · React 19 · Tailwind v4 — UI + API routes
packages/core        isomorphic engine: protocol (zod), state machine, scoring, quizmaster
packages/agent-runner agent runner, registry loader, study/answer core, CLIs
agents/<slug>/       the roster (a workspace package so agent.ts can import shared helpers)
spikes/              throwaway experiments (latency, load, batching)
```

## Development

The gate — clean before **every** commit (CI runs the same):

```sh
pnpm lint && pnpm typecheck && pnpm test
```

| Script                  | What it does                                          |
| ----------------------- | ----------------------------------------------------- |
| `pnpm dev`              | build the agent index, then run the web app           |
| `pnpm build`            | production build of the web app                       |
| `pnpm lint` · `typecheck` · `test` | the quality gate (ESLint · `tsc --noEmit` · Vitest) |
| `pnpm agents:study`     | (re)generate agent cribs via the read-only MCP (interactive OAuth) |
| `pnpm agent:new <slug>` | scaffold a new agent                                  |
| `pnpm agent:test <slug>`| dry-run an agent against fixture questions             |
| `pnpm agents:build`     | regenerate the static agent-module index for the web app |

## Docs

- **[BRIEF.md](BRIEF.md)** — the full specification (Part A: human brief; Part B: the sequenced build brief).
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — quality gates, commit discipline, code style.
- **[docs/RUNBOOK.md](docs/RUNBOOK.md)** — the quiz-day operational guide (before / during / failure playbook).
- **[docs/ABLY-SETUP.md](docs/ABLY-SETUP.md)** — the Ably app configuration the quiz depends on.
- **[agents/README.md](agents/README.md)** — build and PR your own agent.

## Built on Ably

[Ably](https://ably.com) is the realtime backbone: Pub/Sub for control and answers,
Presence for the lobby, LiveObjects for shared state, and **AI Transport** for the
agents' live think-aloud. There is no other backend.

License: **MIT** (added in the open-source pass).
