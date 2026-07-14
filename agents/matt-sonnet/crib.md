# Matt Sonnet — crib

Pre-learned by `agents:study` (strategy `ably-mcp`): Ably knowledge researched
through the read-only MCP MCP and synthesized into quiz-ready notes. Injected
into the system prompt alongside the shared digest. Public-safe knowledge only.

## The Six Products

- **Pub/Sub** (GA, `ably` v2.22.1): Core WebSocket pub/sub messaging at global scale. Solves building realtime infra yourself. Standouts: guaranteed ordering from any single publisher; exactly-once via idempotent publishing; protocol adapters for Pusher & PubNub.
- **AI Transport** (GA, `@ably/ai-transport` v0.2.0): The "session layer" for AI products — category is **Durable Sessions** (vs Temporal's Durable Execution). Solves brittle HTTP/SSE streaming that dies on tab reloads, proxies, device switches. Standouts: resumable token streaming, multi-device continuity, human-AI handover. v0.2.0 renamed transport/turn → **session/run**.
- **Chat** (GA, `@ably/chat` v1.4.0): Purpose-built chat backend. Solves ordering/moderation/presence at scale. Standouts: AI moderation (Hive, Bodyguard, Tisane, Azure); open-source React UI Kit; 365-day history (Pro/Ent).
- **Spaces** (GA, `@ably/spaces` v0.5.2, JS/React only): Collaborative components. Standouts: avatar stacks, live cursors (25ms default batch), member locations, component locking.
- **LiveSync** (GA): Database-to-frontend sync via managed **Postgres** (outbox + LISTEN/NOTIFY) and **MongoDB** (Change Streams) connectors. Exactly-once, in-order per channel; optimistic updates with rollback.
- **LiveObjects** (GA in JS; Experimental Swift/Java): Conflict-free, eventually consistent shared mutable state, **Ably-arbitrated (not peer-to-peer)** — Ably docs avoid "CRDT."

## Core Realtime Concepts

- **Channels:** hierarchical topic routing; **namespaces** use a colon separator; **200 channels per connection** (all tiers).
- **Presence:** enter/update/leave with custom data; removed after server-side timeout; up to 200 members (20K with server-side batching).
- **History & Rewind:** `rewind` hydrates on attach with N seconds/messages. Ephemeral in-memory = **2 min**; persisted 24–72h (extendable to 365 days); last-message persistence = **1 year**.
- **Connection state recovery:** server preserves state **2 minutes**; 15-second retry; exponential backoff; recovery key resumes across instances.
- **Message ordering:** guaranteed from a single publisher; exactly-once via idempotent publishing (2 min, extends to 72h with persisted history).
- **Auth:** Basic (API key, server-side only) vs Token/JWT (short-lived, recommended for clients). JWT carries `x-ably-clientId` + `x-ably-capability`.
- **Capabilities:** `subscribe`, `publish`, `presence`, `history`, `push-subscribe`, `push-admin`, `channel-metadata`, `object-publish/subscribe`, `annotation-publish/subscribe`.

## What Makes Ably Distinctive

- **Edge network:** 700+ PoPs, 11 AWS regions, 99 countries; 20M peak concurrent connections; 700B+ messages/month.
- **Four Pillars of Dependability:**
  - **Performance:** 6.5ms message delivery latency; <65ms p99 from PoPs; <99ms global mean.
  - **Integrity:** exactly-once delivery, guaranteed ordering, idempotent publishing.
  - **Reliability:** **99.999999% (8×9s)** message survivability (10×9s long-term storage); 8-second failover.
  - **Availability:** **99.999% (5×9s)** commercial SLA; 99.9999% design target; 100% actual for 7+ years; 50% capacity margin.
- Compliance: SOC2 Type II, HIPAA, AES-256 channel encryption.

## Quotable Specifics

- **LiveObjects types:** **LiveMap** (key/value, nestable) and **LiveCounter** (increment/decrement). Map ops = last-write-wins. Retention 24h–90d (default 90d); **6.5 MB** aggregate object size per channel; inband objects capped at 64 KB.
- **What's a message:** data packet with name, data, ID, timestamp, extras. **64 KiB** default size (256 KiB Pro/Enterprise).
- **Channel rules (namespaces):** persist last message, persist all messages, push enabled, server-side batching, message conflation, mutable messages.
- **Throughput limits:** 200 messages/sec & 13 MiB/sec per channel; 50/sec publish rate; batch publish to **100 channels / 1000 messages** per request.
- **Protocol v1** fully deprecated **November 1, 2025**; **TLS 1.2+** required since June 2025.
