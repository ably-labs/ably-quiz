# S0 — Latency spike (GO/NO-GO)

Standalone spike answering the go/no-go question (BRIEF §A3): _would an agent even
score on useful questions inside the answer window, or always lose / always time out?_

It runs **one streamed model call per question in the real agent answer shape**
(BRIEF §B2.7) — a ≤2-sentence visible think-aloud followed by strict answer JSON
`{choice, confidence, quip}`, parsed incrementally from the stream — and measures:

- **TTFT** — time to first streamed token (when the think-aloud starts on screen).
- **time-to-answer** — when a valid answer JSON could first be parsed (the moment the quiz can act).
- **accuracy** — did `choice` match, per band, `bare` vs `with-digest`.

No app code, no Ably key. This de-risks the provider SDKs, streaming parse, and JSON
enforcement that the agent runner (S4) is built on.

## Run it

```sh
pnpm --dir spikes/latency install
pnpm --dir spikes/latency spike        # writes RESULTS.md
```

Reads keys from the repo-root `.env.local`. Only providers whose key is present are
run; the rest are **skipped and recorded** in `RESULTS.md`. Day 0 is Anthropic-only
(Opus 4.8 / Sonnet 5 / Fable 5) — re-run as `OPENAI_API_KEY` / `XAI_API_KEY` arrive.

**xAI (Matt's machine):** there's no raw xAI key in `.env.local`, but a real one lives
in the LiteLLM env. Source it at run time (never copied into the repo):

```sh
set -a; source <(grep -E '^XAI_API_KEY=' ~/.provider-keys.env); set +a
XAI_MODEL=grok-4.20-0309-non-reasoning pnpm --dir spikes/latency spike
```

**OpenAI:** not configured anywhere on this machine (LiteLLM fronts xAI/Anthropic/Google,
not OpenAI). `matt-gpt` stays skipped until an `OPENAI_API_KEY` is provided.

### Env knobs (optional)

| var                          | default            | purpose                                            |
| ---------------------------- | ------------------ | -------------------------------------------------- |
| `SPIKE_RUNS`                 | 3                  | runs per (model × variant × question)              |
| `SPIKE_CONCURRENCY`          | 4                  | in-flight calls                                    |
| `SPIKE_TEMPERATURE`          | _unset_            | omitted by default (newer Claude models reject it) |
| `SPIKE_MAX_TOKENS`           | 400                | output budget                                      |
| `SPIKE_TIMEOUT_MS`           | 60000              | per-call timeout                                   |
| `OPENAI_MODEL` / `XAI_MODEL` | see `providers.ts` | override model ids (VERIFY at S4)                  |

## Verdict thresholds (BRIEF §B3 S0.2)

- p95 time-to-answer **≤ 10s** → GO, recommend **20s** window
- **≤ 20s** → GO, recommend **30s** window
- else → **STOP**, flag Matt

## Files

- `questions.ts` — 12 questions in three bands + the shared Ably `study` digest.
  Ably facts verified against `https://ably.com/llms.txt` on 2026-07-11.
- `providers.ts` — Anthropic + OpenAI-compatible (OpenAI/xAI) streaming adapters and the JSON extractor.
- `spike.ts` — orchestrator: builds the task matrix, runs with bounded concurrency, writes `RESULTS.md`.
- `RESULTS.md` — generated table + verdict (S0.2 deliverable).
