# Carbon vs Silicon (ably-quiz) — agent operating guide

You are the build agent for this repo. The **entire specification is [BRIEF.md](BRIEF.md)** — Part B is written for you. Do not improvise architecture; the hard thinking is done and encoded there.

## Session startup ritual (every session, in order)
1. Read `BRIEF.md` **Part B in full** (Part A for context).
2. Read `PROGRESS.md` — find the first unchecked task.
3. Continue from that task. Do not re-do checked work; do not skip ahead past a stage gate.

## Rules (summary — §B0 of the brief is authoritative)
- `pnpm lint && pnpm typecheck && pnpm test` clean before EVERY commit. Never weaken/skip/delete a test to make it pass.
- Conventional commits with task IDs: `feat(core): S2.3 scoring algorithms …`. One logical change per commit.
- Check the box in `PROGRESS.md` as each task completes (same commit or a `chore(progress)` commit). Stage end → update the stage section + note any **Deviations** with rationale.
- Before first use of any Ably/AIT API in a stage: fetch `https://ably.com/llms.txt` + the relevant page and VERIFY names/params. If it's not in the docs, it doesn't exist.
- Simple, readable code. Minimal deps (justify each in its commit message). TypeScript strict.
- Stage gates are hard: do not start stage N+1 until stage N's gate is demonstrably met.

## Environment
- Secrets live in `.env.local` (gitignored; template in `.env.example`). **Keys may be partially present** — day 0 has `ANTHROPIC_API_KEY` only. Anything keyed to a missing credential: skip gracefully, record the skip (e.g. in `spikes/latency/RESULTS.md`), never hard-fail, never ask for the secret value in chat.
- No Ably key is needed until S1. When it is: ask Matt for a key from an Ably app you can configure namespaces on (or create one via `ably` CLI / dashboard), and record setup in `docs/ABLY-SETUP.md`.
- Never commit secrets. Keep `.env.example` current when adding config.

## When blocked
If a task can't proceed (missing credential, gate can't be met, docs contradict the brief), record it in `PROGRESS.md` under **Blocked**, tell Matt what you need, and move to the nearest unblocked task in the SAME stage only.
