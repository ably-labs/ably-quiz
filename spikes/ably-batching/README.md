# S1.3 — batch-timestamp probe

Answers the §B2.1 VERIFY: **do per-message server timestamps survive server-side
batching?** (They're the quiz's fairness clock, §B2.2.)

```sh
pnpm --dir spikes/ably-batching install
pnpm --dir spikes/ably-batching batch-test
```

Reads `ABLY_API_KEY` from the repo-root `.env.local`. Needs the `quiz-answers`
namespace configured with batching @200ms and the `quiz` namespace without
batching (see [docs/ABLY-SETUP.md](../../docs/ABLY-SETUP.md)).

Three probes:

1. **spaced** — 3 messages from one connection, ~40ms apart. Too low-rate to
   trigger the batcher → arrives individually with distinct timestamps.
2. **control** — same, on the non-batched `quiz` namespace.
3. **burst** — N connections (like N players) each publish one message at once.
   This _does_ trigger batching.

**Finding (recorded in docs/ABLY-SETUP.md):** under a real burst, messages in the
same batch flush **share a server timestamp** (measured ~2 distinct timestamps
across 20 simultaneous messages). Per-message timestamps are _not_ preserved
under batch load — `elapsedMs` is quantized to ≤ the batching interval. Also
surfaced: the **per-connection publish limit of 25 msg/s** (error 42911).
