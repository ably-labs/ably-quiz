# AI Transport (AIT) — DX findings (dogfooding log)

This project dogfoods Ably's **AI Transport** so we can feed real DX findings back
to the AIT teams (BRIEF §A2). This file is the running log; we review it in full at
the end of the build. Each finding: what we hit, why it matters, what we did.

---

## Finding 1 — AIT's run/invocation model assumes a **client-initiated** turn; our agents are **broadcast-driven**

**Status:** 🟢 validated + decided (2026-07-13) — real limitation; cheap public-API
workaround proven live; **Matt's call: ship the AIT workaround** (dogfood it, then
hand this finding to the AIT team once S4.2 is built).

**Severity (proposed):** high — it dictates whether AIT fits a whole class of app
(agents that act on an external event, not a user message).

### What we observed

AIT's turn lifecycle is built around an **`Invocation`** that a _client_ sends to
trigger the agent: the canonical agent loop is
`Invocation.fromJSON(req)` → `session.createRun(invocation)` → `run.pipe(llmStream)` → `run.end()`.
i.e. the agent **responds** to an incoming message — a request/response
conversation.

The quiz is **not** a conversation. The host **broadcasts** a `question` control
message on a shared channel; every contestant (human or agent) reacts. Nothing
"invokes" an agent. The agent wants to **proactively** stream its visible
think-aloud the moment it sees a broadcast — there is no client, no request, no
inbound message to build an `Invocation` from.

### Why this matters (Matt's framing, 2026-07-12)

> "If agents cannot participate in conversations unless there's a question [i.e.
> unless they're client-invoked], I think we've got a design problem in the
> protocol. The fact that you're having to work around it is indicative of that
> problem."

An agent that can only act **in response to** an inbound message can't model any
event-driven / autonomous participant — a monitor, a bot reacting to world state,
or a quiz contestant reacting to a broadcast. That's a broad category, so if AIT
can't express agent-initiated turns cleanly, that's worth surfacing to the team.

### Scope note — what was ever on AIT here

To keep the finding precise: **answers were never on AIT.** Humans and agents both
publish answers to the plain fan-in Pub/Sub channel (`quiz-answers`), same clock,
same contract (§B2.7). AIT was only ever proposed for the agent's **visible
thinking stream** + **presence lifecycle** (joining→thinking→answered). So this
finding is strictly about streaming agent-initiated output, not about answer
submission.

### The decision it forces

1. **Use AIT with a workaround** (agent mints / self-triggers its own run) and
   document the workaround as the finding — keeps the dogfooding showcase.
2. **Use plain Ably** for the thinking stream (Pub/Sub deltas or a single
   append-grown message on `quiz-agent:{id}:{slug}`, persistence = history) +
   plain presence; keep answers on the fan-in. The finding then is _"AIT's
   conversational model didn't fit; here's the shape that would have."_

### Validation (Fable-model spike, 2026-07-13, SDK 0.5.0, live vs app `YOUR_APP_ID`)

**Verdict: AIT-workaround** — small, public-API only, proven end-to-end.

> **Validated 2026-07-13 (SDK 0.5.0, live probe against app `YOUR_APP_ID`).** AIT has
> no first-class agent-initiated turn — the docs
> (`/docs/ai-transport/concepts/invocations.md`) state the agent "cannot
> autonomously create or mint its own Invocation," and every streaming path
> requires a run triggered by an input event. However, the Invocation is just a
> `{inputEventId, sessionName}` pointer with no enforced provenance: an agent
> process that co-locates a `ClientSession` on its own session channel can publish
> the trigger itself, convert the returned `ClientRun` to an `Invocation`
> in-process (no HTTP), and stream through its own `AgentSession` — proven
> end-to-end with real token appends and correct history materialization. We ship
> this "self-invocation" pattern and recommend the AIT team promote it to a
> first-class API (e.g. an agent-minted trigger or `createRun({input})`), since
> event-driven / autonomous agents — monitors, broadcast-reactive participants —
> are a broad class the current client-initiated model excludes by fiat rather
> than by mechanism. Presence, by contrast, fit with zero friction.

**Evidence.** Docs are explicit ("Can an Agent Self-Trigger? No."). But `run.start()`
locates the trigger by matching the `event-id` header on _any_ channel message —
it never validates the publisher — so a co-located `ClientSession` publishing the
input event works. Two live probes on `quiz-agent:aitprobe:test`:

- **Probe A (public API):** one Ably client, no external clients, no HTTP —
  `createClientSession` → `view.send(createUserMessage(question))` →
  `clientRun.toInvocation()` handed in-process to `agentSession.createRun()` →
  `start()` matched the self-published trigger (~500 ms) → `pipe()` streamed 8
  tokens → `end()`. `run.messages` materialized (question + think-aloud). ✅
- **Probe B (raw wire publish):** also works but replicates undocumented wire
  headers — fragile, don't ship.

**Workaround shape ("the host is the client"), per agent channel
`quiz-agent:{quizId}:{slug}`:** co-located `ClientSession` publishes the question
as a user turn → `clientRun.toInvocation()` → `agentSession.createRun()` →
`start()` → `pipe(thinkAloudChunks)` → `end()`. ~15 lines, all public API, used in
a topology the docs say doesn't exist. Fragility **moderate** — nothing enforces
client/agent separation today, but a future preview version could; **pin `0.5.0`**.
Side-benefit: the synthetic user turn IS the question, so AIT's materialized
history gives inspectable per-question runs for free. Adapter note: the S4.1
runner uses raw `@anthropic-ai/sdk`/`openai`, so it needs a ~10-line
delta→`UIMessageChunk` mapper (`text-start`/`text-delta`/`text-end`).

**Recommendation (spike): AIT with the workaround.** The dogfooding mandate (§A2)
is the point; the workaround is proven cheap and exercises token streaming, append
rollup, run lifecycle, materialized history, presence, and client-side `useView`
for screens. Plain Ably remains a clean fallback (deltas or one append-grown
message + presence + history) with no protocol bending — but it reduces the
dogfood to "we didn't use it." Either way: answers stay on the plain fan-in;
only thinking-stream + presence touch AIT.

**Build-path decision: DECIDED (Matt, 2026-07-13) — AIT with the workaround.** Build
it in S4.2, pinned to SDK `0.5.0`; answers stay on the plain fan-in. Once S4.2 is
built and exercised, pass this finding + the promote-to-first-class-API ask to the
AIT team.
