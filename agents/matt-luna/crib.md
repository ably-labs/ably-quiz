# Matt Luna — crib

Pre-learned by `agents:study` (strategy `ably-mcp`): Ably knowledge researched
through the read-only MCP and synthesized into quiz-ready notes. Injected
into the system prompt alongside the shared digest. Public-safe knowledge only.

## Products — what / problem / standout

- **Pub/Sub** (GA, `ably` v2.22.1): WebSocket publish/subscribe messaging at global scale. Solves building realtime infra yourself. Standout: guaranteed ordering per publisher; exactly-once via idempotent publishing; protocols WebSocket/MQTT/SSE/HTTP + Pusher & PubNub adapters.
- **AI Transport** (GA, `@ably/ai-transport` v0.2.0): the _session layer_ for AI products = **Durable Sessions** category (vs Temporal's Durable Execution). Solves brittle HTTP streaming, lost sessions on device switch, no human handoff. Standout: resumable token streaming; multi-device continuity; agent presence with crash detection (`idle/thinking/streaming/completed/crashed`). v0.2.0 renamed **transport/turn → session/run**. Node 22+; TypeScript.
- **Chat** (GA, `@ably/chat` v1.4.0; UI Kit v0.3.0): purpose-built chat. Standout: AI moderation (Hive, Bodyguard, Tisane, Azure Content Safety, custom); open-source React UI Kit; idempotent REST publishing + `getVersions()` (v1.4.0).
- **Spaces** (GA, `@ably/spaces` v0.5.2, JS/React only): collaborative components — avatar stacks, live cursors, member locations, component locking. Cursor batching default **25ms**; ~100ms lock acquisition.
- **LiveObjects** (GA in JS; Experimental Swift/Java): conflict-free, eventually consistent shared mutable state. Ably-arbitrated (not peer-to-peer); Ably avoids the term "CRDT."
- **LiveSync** (GA): managed **Postgres** (outbox + LISTEN/NOTIFY) & **MongoDB** (Change Streams) connectors stream DB changes to frontend. Exactly-once, in-order per channel; optimistic updates via Models SDK.

## Core realtime concepts

- **Channels**: hierarchical topic routing; namespaces via **colon separator**; channel rules control persistence/push/batching.
- **Presence**: enter/leave/update with custom data; auto-cleanup on ungraceful disconnect; presence divergence ≤30s.
- **History & rewind**: ephemeral in-memory **2 min** (all accounts); persisted 24h (Free/Standard) → 72h (Pro/Ent), extendable to **365 days**; last-message persistence **1 year**. `rewind` hydrates on attach with N seconds/messages.
- **Connection state recovery**: server state preserved **2 minutes**; **15-second** retry; transport fallback WebSocket → HTTP streaming → HTTP polling; states Initialized→Connecting→Connected→…Disconnected/Suspended/Failed.
- **Message ordering**: guaranteed from any single publisher.
- **Token vs API-key auth**: Basic (API key) = server-side only; Token/JWT (short-lived) = recommended for clients; JWT carries `x-ably-clientId` + `x-ably-capability`.
- **Capabilities**: fine-grained per-channel — `subscribe`, `publish`, `presence`, `history`, `push-subscribe`, `push-admin`, `channel-metadata`, `object-subscribe/publish`, `annotation-publish/subscribe`.

## What makes Ably distinctive

- **Global edge network**: 700+ PoPs, **11 AWS regions**, 99 countries; latency-based DNS routing.
- **Four Pillars of Dependability**:
  - **Performance** — 6.5ms delivery latency; <30ms p99 in-DC; <65ms p99 from PoPs; <99ms global mean.
  - **Integrity** — exactly-once delivery, guaranteed ordering; idempotency within 2 min (72h with persisted history).
  - **Reliability** — 99.999999% (**8×9s**) message survivability; 10×9s long-term storage; 8-second failover.
  - **Availability** — 99.999% commercial SLA, 99.9999% design target, **100% actual for 7+ years**; 50% capacity margin.
- Scale: 700B+ messages/month, 30B+ connections/month, 2B+ devices/month; SOC2 Type II, HIPAA, AES-256 encryption.

## Quotable specifics

- **LiveObjects types**: **LiveMap** (key/value, nestable) & **LiveCounter** (increment/decrement). Map ops = **last-write-wins**. Retention 24h–90d (default 90d); **6.5 MB** aggregate per channel; inband objects capped **64 KB**.
- **A message**: 64 KiB default (256 KiB Pro/Enterprise); has name, data, ID, timestamp, extras.
- **Channel rules/namespaces**: persist last message / all messages, push, server-side batching, conflation, mutable messages.
- **Limits**: Free = 200 concurrent connections/channels, 6M msgs/mo, 1-day history; 200 channels/connection (all tiers); per-channel 200 msgs/sec + 13 MiB/sec; presence 200 standard (up to 20K with batching); batch publish max 100 channels / 1000 msgs / 2 MiB.
- **Deprecations**: Protocol v1 fully deprecated **Nov 1, 2025**; TLS 1.0/1.1 dropped **June 2025** (TLS 1.2+ required).
