# Matt Grok — crib

Pre-learned by `agents:study` (strategy `ably-mcp`): Ably knowledge researched
through the read-only MCP and synthesized into quiz-ready notes. Injected
into the system prompt alongside the shared digest. Public-safe knowledge only.

## Products — what & why

- **Pub/Sub** (GA, `ably` v2.22.1): core WebSocket pub/sub messaging at global scale. Solves building realtime infra yourself. Standout: guaranteed ordering per publisher, exactly-once via idempotent publishing, protocol flexibility (WebSocket, MQTT, SSE, HTTP + Pusher/PubNub adapters).
- **Chat** (GA, `@ably/chat` v1.4.0): purpose-built chat platform. Solves ordering/presence/moderation at scale. Standout: AI moderation (Hive, Bodyguard, Tisane, Azure, custom Lambda/webhook), open-source React UI Kit, User Claims (server-signed per-room JWT metadata).
- **Spaces** (GA, `@ably/spaces` v0.5.2, JS/React only): collaborative components. Solves multiplayer UX plumbing. Standout: avatar stacks, live cursors (25ms batch), member locations, component locking.
- **LiveObjects** (GA JS; experimental Swift/Java): conflict-free, eventually-consistent shared state. Standout: **LiveMap** (key/value, nestable) and **LiveCounter** (increment/decrement). Ably-arbitrated (not P2P); map ops use last-write-wins. Ably avoids the term "CRDT."
- **LiveSync** (GA): database-to-frontend sync via managed **Postgres** (outbox + LISTEN/NOTIFY) and **MongoDB** (Change Streams) connectors. Standout: exactly-once, in-order per channel; optimistic updates with rollback (Models SDK).
- **AI Transport** (GA, `@ably/ai-transport` v0.2.0, TS/Node 22+): the "**Durable Sessions**" session layer for AI. Solves brittle HTTP/SSE streaming, lost sessions across devices, human-AI handover. v0.2.0 renamed transport/turn → **session/run**. Note: Vercel AI SDK is **complementary, not a competitor**.

## Core realtime concepts

- **Channels**: hierarchical topic routing, namespaces via colon separator.
- **Presence**: enter/leave/update with data; auto-cleanup after server timeout; ≤200 members standard, up to 20K with batching.
- **History**: ephemeral in-memory **2 min** (all accounts); persisted 24h (Free/Standard) – 72h (Pro/Ent), extendable to **365 days**; last-message persistence **1 year**.
- **Rewind**: hydrate on attach with N seconds/messages of recent history.
- **Connection state recovery**: server preserves state **2 minutes**; auto-reconnect exponential backoff, 15-sec retry; transport fallback WebSocket → HTTP streaming → HTTP polling.
- **Message ordering**: guaranteed from any single publisher.
- **Auth**: Basic (API key, server-side only) vs Token/JWT (short-lived, recommended for clients); JWT carries `x-ably-clientId` + `x-ably-capability`.
- **Capabilities**: per-channel perms — `subscribe`, `publish`, `presence`, `history`, `push-subscribe`, `push-admin`, `channel-metadata`, plus `message-update/delete-own/any`, `object-subscribe/publish`, `annotation-publish/subscribe`.

## What makes Ably distinctive

- **Global edge**: 700+ PoPs, 11 AWS regions, 99 countries.
- **Four Pillars of Dependability**: **Performance** (6.5ms delivery latency, <65ms p99 from PoPs, <99ms global mean) · **Integrity** (exactly-once, guaranteed ordering, idempotency within 2 min) · **Reliability** (99.999999% / 8-nines message survivability, 8-sec failover) · **Availability** (99.999% commercial SLA, 99.9999% design target, 100% actual 7+ years).
- 30B+ connections/month, 700B+ messages/month. SOC2 Type II, HIPAA, AES-256 channel encryption.

## Quotable specifics

- **Message**: name, data, ID, timestamp, extras. Default **64 KiB** (256 KiB Pro/Enterprise). Batch publish to up to **100 channels**, 1000 messages, 2 MiB.
- **Channel rules/namespaces**: persist last message (1yr) / persist all / push enabled / server-side batching / conflation / mutable messages.
- **Limits**: 200 channels per connection (all tiers); per-channel 50 publishes/sec, 1024 KiB/sec, 200 msgs/sec throughput; Free = 200 concurrent connections/channels, 6M msgs/month.
- **LiveObjects storage**: 6.5 MB aggregate per channel; retention 24h–90 days (default 90).
