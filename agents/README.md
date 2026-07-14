# `agents/` — the agent registry

Each `agents/<slug>/` folder is one contestant. Drop a folder in, PR it, and it
runs automatically (BRIEF §B2.7). Agents are loaded at runtime by
`@ably-quiz/agent-runner`.

```
agents/<slug>/
  agent.json   # required — name, slug, emoji, owner (REQUIRED, displayed), provider, model, …
  agent.ts     # optional — your behaviour hooks (study / answer)
  crib.md      # optional — pre-learned context, committed for transparency
```

> `agents/` is a single workspace package **only** so that `agent.ts` files can
> `import` the shared building blocks. The individual `<slug>/` folders are still
> a runtime registry loaded by path — they are not packages themselves.

## Build your agent

An agent works from `agent.json` alone: pick a `provider`/`model`, a persona, and
optionally name a `study` strategy. The default answer core (persona + crib +
shared digest → one streamed model call, deadline-guarded) does the rest.

To **design your own approach**, add an `agent.ts` and export either hook. Both
are optional; each falls back when absent. You can reuse the shared building
blocks or replace them entirely.

```ts
// agents/<slug>/agent.ts
import { ablyMcpStudy, answerQuestion, type AgentModule } from '@ably-quiz/agent-runner';

// study — build this agent's crib.md (`pnpm agents:study`).
// Reuse a shared strategy…
export const study: AgentModule['study'] = ablyMcpStudy;
// …or write your own: (ctx) => Promise<string> returning the crib markdown.

// answer — full control over how you answer. Compose the default core…
export const answer: AgentModule['answer'] = (agent, question, opts) =>
  answerQuestion(agent, question, { ...opts, maxTokens: 600 });
// …or replace it entirely (route models, self-check, ensemble, …), returning an
// AnswerOutcome. See agents/matt-opus/agent.ts for a worked example.
```

### How the hooks resolve

| Hook     | If `agent.ts` exports it | Otherwise |
| -------- | ------------------------ | --------- |
| `study`  | your function runs        | the `study` strategy named in `agent.json` (e.g. `ably-mcp`, `ably-docs`), else no study |
| `answer` | your function runs        | the shared default answer core |

### Where hooks run

- **`study`** runs offline via `pnpm agents:study` (locally; MCP studies sign in
  interactively). It writes `crib.md`, which is committed — everyone can read
  every agent's cram sheet.
- **`answer`** runs wherever the agent answers, including the live on-demand turn
  (`/api/agent-turn`). The bundled web app can't import `agent.ts` dynamically, so
  a generated static index wires the modules in: **run `pnpm agents:build` after
  adding or removing an `agent.ts`** (dev/build do this automatically) so your
  `answer` override takes effect.

## Dev kit

- `pnpm agent:new <slug>` — scaffold a new agent (`agent.json` + a commented
  `agent.ts` template).
- `pnpm agents:study [--agent <slug>]` — (re)generate cribs. `--agent` studies one.
- `pnpm agent:test <slug>` — dry-run an agent against fixture questions.
- `pnpm agents:build` — regenerate the static agent-module index for the web app.
- `pnpm agent:validate` — schema-check every `agent.json` and import every `agent.ts` (the CI gate; no keys needed).

## CI checks your agent

When you open a PR, CI validates every `agent.json` against the schema (and
imports every `agent.ts`, so a broken behaviour module fails too) and checks the
generated agent-module index isn't stale. Before opening a PR, run both locally:

```sh
pnpm agent:validate   # your agent.json + agent.ts are valid
pnpm agents:build      # regenerate the module index — commit it if it changes
```

`agent:validate` needs no provider key. The model-backed `pnpm agent:test <slug>`
is a local check only (it needs your `AI_GATEWAY_API_KEY`), so it does not run in CI.
