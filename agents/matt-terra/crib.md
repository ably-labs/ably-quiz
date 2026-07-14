# Matt Terra — crib

Pre-learned by `agents:study` (strategy `ably-mcp`): Ably knowledge researched
through the read-only MCP MCP and synthesized into quiz-ready notes. Injected
into the system prompt alongside the shared digest. Public-safe knowledge only.

## The Six Products

- **Pub/Sub** (GA) — WebSocket publish/subscribe messaging at global scale. Solves building realtime infra yourself. Standout: guaranteed ordering from any single publisher; exactly-once via idempotent publishing; protocol adapters for MQTT/SSE/HTTP + Pusher/PubNub.
- **AI Transport** (GA, `@ably/ai-transport` v0.2.0) — the "session layer" for AI apps; Ably's take on the **Durable Sessions** category (vs Temporal's Durable Execution). Solves brittle HTTP/SSE streaming that dies on tab reload, device switch, or proxy timeout. Standout: resumable token streaming, multi-device continuity, human↔AI handover. v0.2.0 renamed transport/turn → **session/run**.
- **Chat** (GA, `@ably/chat` v1.4.0) — purpose-built chat backend. Solves ordering, moderation, typing/presence at scale. Standout: AI moderation (Hive, Bodyguard, Tisane, Azure) + open-source React UI Kit.
- **Spaces** (GA, `@ably/spaces` v0.5.2, JS/React only) — collaborative multiplayer components: avatar stacks, live cursors, member locations, component locking.
- **LiveSync** (GA) — streams DB changes to frontends via managed **Postgres** (outbox pattern) & **MongoDB** (change streams) connectors. Exactly-once, in-order per channel.
- **LiveObjects** (GA in JS; Experimental Swift/Java) — conflict-free, eventually-consistent shared mutable state, **Ably-arbitrated** (not peer-to-peer). Ably avoids the term "CRDT."

## Core Realtime Concepts

- **Channels**: hierarchical topic routing, namespaces via **colon separator**; 200 channels per connection.
- **Presence**: enter/leave/update with custom data; auto-cleanup on ungraceful disconnect. 200 members standard; up to 20K with server-side batching.
- **History & Rewind**: ephemeral in-memory = **2 min**; persisted = 24h (Free/Standard) to 72h (Pro/Ent), extendable to **365 days**; last-message persistence = **1 year**. `rewind` hydrates on attach.
- **Connection state recovery**: server-side state kept **2 minutes**; 15-sec retry interval; transport fallback WebSocket → HTTP streaming → HTTP polling.
- **Ordering**: guaranteed from any single publisher.
- **Auth**: **Basic (API key)** = server-side only; **Token/JWT** = recommended for clients. **Capabilities** = per-channel permissions (subscribe, publish, presence, history, etc.).

## What Makes Ably Distinctive

- Global edge network: **700+ PoPs**, **11 AWS regions**, 99 countries; ~20M peak concurrent connections.
- **Four Pillars of Dependability**:
  - **Performance** — 6.5ms message delivery latency; <65ms p99 from PoPs; <99ms global mean.
  - **Integrity** — exactly-once delivery, guaranteed ordering, idempotent publishing.
  - **Reliability** — **99.999999% (8×9s)** message survivability; **10×9s** for long-term storage; 8-second failover.
  - **Availability** — **99.999% commercial SLA**; 99.9999% design target; **100% actual uptime 7+ years**; 50% capacity margin.

## Quotable Specifics

- **LiveObjects types**: **LiveMap** (key/value, nestable) + **LiveCounter** (increment/decrement). Map ops = **last-write-wins**. Retention 24h–90d (default 90). Aggregate object size per channel = **6.5 MB**. Inband object cap = 64 KB.
- **Message**: name, data, ID, timestamp, extras. Default size **64 KiB** (256 KiB Pro/Enterprise). Batch publish: up to **100 channels / 1000 messages / 2 MiB**.
- **Channel throughput**: 200 msgs/sec, 13 MiB/sec per channel; 50/sec publish rate limit.
- **Free tier limits**: 6M messages/month, 200 concurrent connections, 200 channels.
- **Deprecations**: Protocol v1 fully deprecated **Nov 1, 2025**; TLS 1.0/1.1 dropped June 2025 (TLS 1.2+ required).
