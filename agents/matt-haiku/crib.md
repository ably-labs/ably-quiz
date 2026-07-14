# Matt Haiku — crib

Pre-learned by `agents:study` (strategy `ably-mcp`): Ably knowledge researched
through the read-only MCP MCP and synthesized into quiz-ready notes. Injected
into the system prompt alongside the shared digest. Public-safe knowledge only.

## Products

- **Pub/Sub** (GA, `ably` v2.22.1): WebSocket pub/sub messaging at global scale. Solves building realtime infra yourself. Standout: **guaranteed ordering from a single publisher**, **exactly-once via idempotent publishing**; protocols WebSocket/MQTT/SSE/HTTP + Pusher/PubNub adapters.
- **Chat** (GA, `@ably/chat` v1.4.0): purpose-built chat, built on Pub/Sub. Standout: **AI moderation** (Hive, Bodyguard, Tisane, Azure, custom Lambda/webhook), open-source React UI Kit, User Claims (tamper-proof per-room JWT metadata).
- **Spaces** (GA, `@ably/spaces` v0.5.2, JS/React only): collaborative components — **avatar stacks, live cursors, member locations, component locking**. Cursor batch default 25ms; members removed 15s after disconnect (default `offlineTimeout` 120,000ms).
- **LiveObjects** (GA JS; Experimental Swift/Java): conflict-free, eventually-consistent shared state, **Ably-arbitrated (not peer-to-peer, docs avoid "CRDT")**. Map ops = last-write-wins.
- **LiveSync** (GA): managed **Postgres (outbox + LISTEN/NOTIFY) and MongoDB (change streams)** connectors, DB→frontend. Exactly-once, in-order per channel; optimistic updates with rollback via Models SDK.
- **AI Transport** (GA, `@ably/ai-transport` v0.2.0, Node 22+): the **"Durable Sessions"** layer for AI — resumable token streaming, multi-device continuity, human-AI handover. v0.2.0 renamed transport/turn → **session/run**. Needs namespace `mutableMessages: true`.

## Core Realtime Concepts

- **Channels**: hierarchical topic routing; **namespaces use colon separator**; 200 channels per connection.
- **Presence**: enter/leave/update with custom data; auto-cleanup on ungraceful disconnect; presence divergence ≤30s.
- **History**: ephemeral 2 min (all accounts); persisted 24h (Free/Standard) → 72h (Pro/Ent), extendable to 365 days; last-message persistence 1 year.
- **Rewind**: hydrate on attach with N seconds/messages of recent history.
- **Connection state recovery**: server state preserved **2 minutes**; 15s retry interval, exponential backoff; transport fallback WebSocket → HTTP streaming → HTTP polling.
- **Auth**: Basic (API key, server-side only) vs Token/JWT (short-lived, client-side recommended); JWT carries `x-ably-clientId` + `x-ably-capability`.
- **Capabilities**: `subscribe`, `publish`, `presence`, `history`, `push-subscribe`, `push-admin`, `channel-metadata`, plus message-update/delete-own/any, object-subscribe/publish, annotation-publish/subscribe.

## What Makes Ably Distinctive

- **Global edge network**: 700+ PoPs, 11 AWS regions, 99 countries; 2B+ devices/mo, 700B+ messages/mo, 20M peak concurrent connections.
- **Four Pillars of Dependability**:
  - **Performance** — 6.5ms delivery latency; <65ms p99 from PoPs; <99ms global mean.
  - **Integrity** — exactly-once delivery, guaranteed ordering, idempotency (2 min, → 72h with persistence).
  - **Reliability** — **99.999999% (8×9s) survivability** (10×9s long-term); 8-second failover; survives 2 simultaneous AZ failures.
  - **Availability** — **99.999% commercial SLA**, 99.9999% design target, **100% actual for 7+ years**; 50% capacity margin.

## Quotable Specifics

- **LiveObjects types**: **LiveMap** (key/value, nestable) and **LiveCounter** (increment/decrement). Retention 24h–90d (default 90d); **6.5 MB aggregate per channel**; inband objects capped at 64 KB.
- **What's a message**: name, data, ID, timestamp, extras. Default size **64 KiB** (256 KiB Pro/Ent). Per-channel: 200 msg/sec, 13 MiB/sec throughput.
- **Channel rules/namespaces**: persist last message, persist all, push enabled, server-side batching, message conflation, mutable messages.
- **Limits**: Free = 200 concurrent connections/channels, 6M msgs/mo; batch publish ≤100 channels, ≤1000 messages, 2 MiB; presence 200 standard → up to 20K with batching (Enterprise).
- **Deprecations**: Protocol v1 fully deprecated **Nov 1, 2025**; TLS 1.0/1.1 dropped June 2025 (TLS 1.2+ required).
