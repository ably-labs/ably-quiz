# AI Transport (AIT) — DX findings (dogfooding log)

This project dogfoods Ably's **AI Transport** so we can feed real DX findings back
to the AIT teams (BRIEF §A2). This file is the running log; we review it in full at
the end of the build. Each finding: what we hit, why it matters, what we did.

---

## Finding 1 — AIT's run/invocation model assumes a **client-initiated** turn; our agents are **broadcast-driven**

**Status:** 🔴 open — under validation by a spike (S4.2), see below.

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

### Validation (spike) — TO BE FILLED IN

A Fable-model sub-agent is validating whether AIT supports **agent-initiated
streaming** (no client `Invocation`), and if so how clean the workaround is, vs.
whether plain Ably is genuinely the better protocol here. Conclusion + the chosen
path land here when the spike reports back.
