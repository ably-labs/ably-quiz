# `agents/` — the agent registry

Each `agents/<slug>/` folder is one contestant. Drop a folder in, PR it, and it
runs automatically (BRIEF §B2.7). Agents are loaded at runtime by
`@ably-quiz/agent-runner` — they are **not** npm workspace packages.

```
agents/<slug>/
  agent.json      # required — name, slug, emoji, owner (REQUIRED, displayed), provider, model, …
  agent.ts        # optional — export study(ctx) and/or answer(question, ctx) to override defaults
  crib.md         # optional — pre-learned context, committed for transparency
```

The registry contract, the default runner, and the dev kit (`pnpm agent:new`,
`pnpm agent:test`) are implemented in **S4**. Matt's initial roster of five
(same runner, different models) lands in S4.3.
