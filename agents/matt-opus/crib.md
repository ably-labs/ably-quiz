# Matt Opus — crib

Pre-learned by `agents:study` (strategy `ably-mcp`): Ably knowledge researched
through the read-only MCP MCP and synthesized into quiz-ready notes. Injected
into the system prompt alongside the shared digest. Public-safe knowledge only.

## Products (what / problem / standout)

- **Pub/Sub (GA, `ably` v2.22.1):** WebSocket publish/subscribe messaging at global scale; removes need to build realtime infra. Standouts: 99.999999% message survivability; guaranteed ordering from any single publisher; exactly-once via idempotent publishing. Protocols: WebSockets, MQTT, SSE, HTTP + Pusher/PubNub adapters.
- **Chat (GA, `@ably/chat` v1.4.0):** Purpose-built chat API; solves ordering/presence/moderation at scale. Standouts: AI moderation (Hive, Bodyguard, Tisane, Azure, custom Lambda/webhook); open-source React UI Kit (`@ably/chat-react-ui-kit` v0.3.0); tamper-proof server-signed **User Claims**.
- **Spaces (GA, `@ably/spaces` v0.5.2, JS/React only):** Multiplayer collaboration components. Standouts: avatar stacks, live cursors (25ms default batch interval), member locations, component locking (~100ms acquisition).
- **LiveObjects (GA JS; Experimental Swift/Java):** Conflict-free, eventually consistent shared mutable state. Standouts: **LiveMap** + **LiveCounter**; Ably-arbitrated (not peer-to-peer); map ops use last-write-wins. (Ably avoids the term "CRDT".)
- **LiveSync (GA):** Streams DB changes to frontends via managed **Postgres** (outbox + LISTEN/NOTIFY) and **MongoDB** (Change Streams) connectors; exactly-once, in-order per channel; optimistic updates with rollback.
- **AI Transport (GA, `@ably/ai-transport` v0.2.0):** Session layer for AI apps ("Durable Sessions" category). Solves brittle HTTP streaming/lost session state. Standouts: resumable token streaming, multi-device continuity, human-AI handover. v0.2.0 renamed transport/turn → **session/run**.

## Core realtime concepts

- **Channels:** hierarchical topic routing; namespaces use a colon (`:`) separator; **200 channels per connection** limit.
- **Presence:** enter/leave/update with custom data; auto-cleanup on ungraceful disconnect; up to 200 members (up to 20K with server-side batching).
- **History & rewind:** ephemeral 2-min in-memory (all accounts); persisted 24h–72h, extendable to 365 days (Pro/Ent); last-message persistence 1 year. `rewind` hydrates on attach with N seconds/messages.
- **Connection state recovery:** server-side state preserved **2 minutes**; automatic message retrieval within that window; retry interval 15s with exponential backoff+jitter; transport fallback WebSocket → HTTP streaming → HTTP polling.
- **Message ordering:** guaranteed from any single publisher.
- **Token vs API-key auth:** Basic (API key) = server-side only; Token auth (short-lived) recommended for clients; JWT can embed `x-ably-clientId` / `x-ably-capability`.
- **Capabilities:** per-channel permissions incl. `subscribe`, `publish`, `presence`, `history`, `push-subscribe`, `push-admin`, `channel-metadata`, `object-publish/subscribe`, `annotation-publish/subscribe`.

## What makes Ably distinctive

- Global edge network: **700+ PoPs**, **11 AWS regions**, 99 countries; 700B+ messages/month.
- **Four Pillars of Dependability:**
  - **Performance:** 6.5ms delivery latency; <65ms p99 from PoPs; <99ms global mean.
  - **Integrity:** exactly-once delivery, guaranteed ordering, idempotent publishing (2 min, up to 72h with persistence).
  - **Reliability:** 99.999999% (8×9s) survivability; 8-second failover; survives 2 simultaneous AZ failures.
  - **Availability:** 99.999% commercial SLA; 99.9999% design target; 50% capacity margin; 100% actual uptime 7+ years.

## Quotable specifics

- **LiveObjects types:** LiveMap (key/value, nestable) + LiveCounter (increment/decrement); 6.5 MB aggregate object size per channel; retention 24h–90d (default 90d).
- **Message:** data packet with name, data, ID, timestamp, extras. Default size **64 KiB** (256 KiB Pro/Ent); batch up to **1000 messages per BatchSpec**, **100 channels** per batch REST request.
- **Channel rules/namespaces:** persist-last-message (1yr), persist-all, push, server-side batching, conflation, mutable messages.
- **Limits:** per-channel 200 msg/sec & 13 MiB/sec throughput; Free tier 6M msgs/month, 200 concurrent connections; TLS 1.2+ required; Protocol v1 fully deprecated **Nov 1, 2025**.
