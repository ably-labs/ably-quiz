# Contributing to Carbon vs Silicon

Thanks for building. This repo becomes an open-source demo people learn from, so
the bar is **simple, readable, correct**. The full specification is [BRIEF.md](BRIEF.md);
this file distils the working rules (§B0).

## Quality gates — before EVERY commit

```sh
pnpm lint && pnpm typecheck && pnpm test
```

All three must pass clean. CI runs the same on every PR and push to `main`
(plus `pnpm format:check`).

- **Never weaken, skip, or delete a test to make it pass.** If a test fails, the
  code is wrong — fix the code.
- **New logic in `packages/core`** (protocol, scoring, engine) ships with unit
  tests in the same commit.

## Commit discipline

- [Conventional Commits](https://www.conventionalcommits.org/), scoped, referencing
  the task ID from the brief:
  - `feat(core): S2.3 scoring algorithms with counterfactual recompute`
  - `chore(repo): S1.1 pnpm monorepo scaffold`
- **One logical change per commit.** No drive-by refactors — the history should
  read as the build plan executing.
- Update [PROGRESS.md](PROGRESS.md) as tasks land; record any deviation from the
  brief under **Deviations** with a one-line rationale. Never diverge silently.

## Code style

- **TypeScript strict everywhere** (`tsconfig.base.json`: `strict`,
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`).
- ESLint (flat config, `eslint.config.mjs`) + Prettier (`.prettierrc.json`),
  enforced in CI. Run `pnpm lint:fix` and `pnpm format` to auto-fix.
- Small modules, explicit names. Comments only where the _why_ isn't obvious.
- **Minimal dependencies** — justify every new package in the commit message that
  adds it.
- Secrets only via env vars. `.env.local` is gitignored; keep `.env.example` current.

## Ably / AIT API rule

Before the first use of any Ably or AI Transport API in a stage, fetch
`https://ably.com/llms.txt` and the relevant doc page and **verify method
names/params against the live docs**. If an API isn't in the docs, it doesn't
exist — don't invent it.

## Repo layout

```
apps/web            Next.js (App Router) UI + API routes
packages/core       isomorphic engine: protocol, state machine, scoring, quizmaster
packages/agent-runner  the default agent runner + registry loader
agents/<slug>/      the agent registry (PR your own — see agents/README.md)
spikes/             throwaway experiments (e.g. the S0 latency spike)
```

## Workflow commands

| command                             | what it does                       |
| ----------------------------------- | ---------------------------------- |
| `pnpm dev`                          | run the web app                    |
| `pnpm build`                        | production build of the web app    |
| `pnpm lint` / `pnpm lint:fix`       | ESLint over the repo               |
| `pnpm format` / `pnpm format:check` | Prettier                           |
| `pnpm typecheck`                    | `tsc --noEmit` across all packages |
| `pnpm test`                         | Vitest (engine unit tests)         |
