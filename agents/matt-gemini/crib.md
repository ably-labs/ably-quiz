# Matt Gemini — crib

Pre-learned by `agents:study` (strategy `ably-mcp`): Ably knowledge researched
through the read-only MCP MCP and synthesized into quiz-ready notes. Injected
into the system prompt alongside the shared digest. Public-safe knowledge only.

## Products (what / problem / standout)
- **Pub/Sub** (GA, `ably` v2.22.1): WebSocket pub/sub messaging at global scale. Solves building realtime infra yourself. Standout: guaranteed ordering from any single publisher; exactly-once via idempotent publishing; protocols incl. WebSockets, MQTT, SSE, HTTP + Pusher/PubNub adapters.
- **AI Transport** (GA, `@ably/ai-transport` v0.2.0): the "session layer" / **Durable Sessions** category for AI apps. Solves brittle HTTP streaming, lost sessions on device switch, broken human handoff. Standout: resumable token streaming; multi-device continuity; agent crash detection via presence. (Vercel AI SDK is *complementary, not a competitor*.)
- **Chat** (GA, `@ably/chat` v1.4.0): purpose-built chat. Standout: AI moderation (Hive, Bodyguard, Tisane, Azure) + open-source React UI Kit; up to 365-day history.
- **Spaces** (GA, `@ably/spaces` v0.5.2, JS/React only): collaborative components — avatar stacks, live cursors, member locations, component locking. Standout: 25ms cursor batching; ~100ms lock acquisition.
- **LiveSync** (GA): streams DB changes to frontends via managed **Postgres** (outbox + LISTEN/NOTIFY) and **MongoDB** (Change Streams) connectors. Standout: exactly-once, in-order per channel; optimistic updates with rollback (Models SDK).
- **LiveObjects** (GA JS; Experimental Swift/Java): shared mutable state that syncs across clients, eventually consistent.

## Core realtime concepts
- **Channels**: hierarchical topic routing; namespaces use a **colon (`:`) separator**; channel rules govern persistence/push/batching.
- **Presence**: enter/leave/update with custom data; auto-cleanup on ungraceful disconnect after server timeout.
- **History**: ephemeral 2 min (all accounts); persisted 24h (Free/Std)→72h (Pro/Ent), extendable to **365 days**; last-message persistence 1 year.
- **Rewind**: hydrate on attach with N seconds/messages of recent history.
- **Connection state recovery**: server preserves state **2 minutes**; 15-sec retry interval; transport fallback WebSocket → HTTP streaming → HTTP polling.
- **Ordering**: guaranteed from any single publisher.
- **Auth**: Basic (API key, server-side only) vs Token/JWT (short-lived, client-side recommended). **Capabilities** = per-channel permissions (`subscribe`, `publish`, `presence`, `history`, `push-subscribe`, `push-admin`, `channel-metadata`, etc.).

## What makes Ably distinctive
- **Global edge network**: 700+ PoPs, 11 AWS regions, 99 countries.
- **Four Pillars of Dependability**:
  - **Performance**: 6.5ms message delivery latency; <30ms p99 in-DC; <65ms p99 from PoPs; <99ms global mean.
  - **Integrity**: exactly-once delivery, guaranteed ordering, idempotent publishing.
  - **Reliability**: **99.999999% (8×9s)** message survivability; 10×9s for long-term storage; 8-second failover.
  - **Availability**: **99.999% (5×9s)** commercial SLA; 99.9999% design target; 100% actual for 7+ years; 50% capacity margin.
- Scale: 2B+ devices/mo, 30B+ connections/mo, 700B+ messages/mo.

## Quotable specifics
- **LiveObjects types**: **LiveMap** (key/value; nests maps/counters) and **LiveCounter** (increment/decrement). Conflict-free, commutative, eventually consistent, **Ably-arbitrated** (not peer-to-peer); maps use **last-write-wins**. Object retention 24h–90d (default 90); **6.5 MB aggregate per channel**; inband objects capped 64 KB.
- **What counts as a message**: data packet with name, data, ID, timestamp, extras. Default size **64 KiB** (256 KiB Pro/Enterprise). Batch publish: up to **100 channels**, **1000 messages**, 2 MiB.
- **Limits**: 200 channels per connection; per-channel **50 msg/sec**, 1024 KiB/sec; presence 200 members standard (up to 20K with server-side batching); Free tier = 200 connections/channels, 6M msgs/mo.
- **Deprecations**: Protocol v1 fully deprecated **Nov 1, 2025**; TLS 1.0/1.1 dropped June 2025.
