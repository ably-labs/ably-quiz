# Matt Grok Think — crib

Pre-learned by `agents:study` (strategy `ably-mcp`): Ably knowledge researched
through the read-only MCP MCP and synthesized into quiz-ready notes. Injected
into the system prompt alongside the shared digest. Public-safe knowledge only.

## Platform Foundation
- **11 AWS regions**, **700+ edge PoPs (Points of Presence)**, **99 countries**; 20M peak concurrent connections.
- Scale: **2B+ devices/month, 30B+ connections/month, 2T+ API ops/month, 700B+ messages/month**.
- Security: **SOC2 Type II, HIPAA, AES-256** channel encryption; TLS 1.2+ required (TLS 1.0/1.1 dropped June 2025).
- Protocol v1 fully deprecated **Nov 1, 2025**; v2 is current (since Jan 2023).

## Four Pillars of Dependability
- **Performance:** 6.5ms message delivery latency; <30ms p99 in-DC; <65ms p99 from PoPs; <99ms global mean.
- **Integrity:** exactly-once delivery, guaranteed ordering, idempotent publishing (2 min, extends to 72h with persisted history).
- **Reliability:** **99.999999% (8×9s)** message survivability; **10×9s** for long-term storage; multi-AZ, 8-second failover.
- **Availability:** **99.999% (5×9s) commercial SLA**; 99.9999% design target; 100% actual for 7+ years; 50% capacity margin.

## Products
- **Pub/Sub** (GA, `ably` v2.22.1): WebSocket pub/sub messaging at global scale. Guaranteed ordering per publisher; protocol flexibility (WebSockets/MQTT/SSE/HTTP + Pusher/PubNub adapters).
- **AI Transport** (GA, `@ably/ai-transport` v0.2.0): the **Durable Sessions** layer for AI — resumable token streaming, multi-device continuity, human-AI handover. v0.2.0 renamed API from transport/turn → **session/run**. Vercel AI SDK is complementary, not a competitor.
- **Chat** (GA, `@ably/chat` v1.4.0): purpose-built chat — AI moderation (Hive, Bodyguard, Tisane, Azure), reactions, typing, open-source React UI Kit, 365-day history.
- **Spaces** (GA, `@ably/spaces` v0.5.2, JS/React only): collaborative components — avatar stacks, live cursors (25ms batch), member locations, component locking.
- **LiveSync** (GA): DB-to-frontend sync via managed **Postgres (outbox) + MongoDB (Change Streams)** connectors; exactly-once, in-order.
- **LiveObjects** (GA JS; experimental Swift/Java): conflict-free, eventually consistent shared state, Ably-arbitrated (not peer-to-peer/CRDT).

## Core Realtime Concepts
- **Channels:** hierarchical topic routing; namespaces use a **colon (`:`) separator**; channel rules configure persistence/push/batching.
- **Presence:** enter/leave/update with data; auto-cleanup on ungraceful disconnect (server timeout); up to 200 members standard, up to **20K with server-side batching**.
- **History & rewind:** ephemeral in-memory **2 min** (all accounts); persisted 24–72h (extendable to **365 days**); last-message persistence **1 year**. `rewind` hydrates on attach with N seconds/messages.
- **Connection state recovery:** server state preserved **2 minutes**; 15-second retry; transport fallback WebSocket → HTTP streaming → HTTP polling; connection state machine (Initialized→Connecting→Connected…Disconnected/Suspended/Failed).
- **Auth:** Basic (API key, server-side only) vs **Token/JWT** (short-lived, client-side recommended). Capabilities: `subscribe`, `publish`, `presence`, `history`, `push-subscribe`, `push-admin`, `channel-metadata`, `object-publish/subscribe`, etc.

## Quotable Specifics
- **Message:** name, data, ID, timestamp, extras. Default size **64 KiB** (Free/Standard), **256 KiB** (Pro/Enterprise).
- **Batch:** up to **100 channels, 1000 messages, 2 MiB** per REST request.
- **LiveObjects types:** **LiveMap** (key/value, nestable) + **LiveCounter** (increment/decrement). Map ops = last-write-wins; retention 24h–90d (default 90d); **6.5 MB aggregate per channel**; inband objects capped 64 KB.
- **Per-channel throughput:** 200 msg/sec, 13 MiB/sec; channel activation <200ms p99.
- **Limits:** Free = 200 concurrent connections/channels, 6M msgs/mo, 25K HTTP req/hr; channels per connection capped at **200** on all tiers.
