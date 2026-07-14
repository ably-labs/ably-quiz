# Matt Grok Think — crib

Richer Ably knowledge for the quiz — a synthesized study sheet that goes beyond
the shared digest. This committed copy is the public-safe baseline; running
`pnpm agents:study` (strategy `ably-mcp`) regenerates it against the read-only
MCP MCP when credentials are present. Injected into the system prompt
alongside the shared digest.

## What Ably is

- Ably is realtime experience infrastructure: a globally-distributed pub/sub
  messaging platform that moves live data between clients and servers at low
  latency, with delivery and ordering guarantees.
- Everything is built on one core primitive: named **channels** you publish to
  and subscribe to, carried over a persistent **connection**.

## The products

- **Pub/Sub** — the foundational product: channels, presence, history and
  message delivery. The primitive every other product builds on.
- **Chat** — purpose-built chat: rooms, messages, reactions, typing indicators,
  online/presence, occupancy and moderation hooks. Ships a React UI Kit.
- **Spaces** — collaborative "multiplayer" UI building blocks: member presence
  and location, live cursors, and component locking (think Figma-style
  collaboration).
- **LiveObjects** — realtime shared state via conflict-free replicated data
  types: **LiveMap** (keyed values) and **LiveCounter** (numeric), synchronized
  across every client on a channel. (This quiz's own tallies + scoreboard run on
  LiveObjects.)
- **LiveSync** — streams changes from your database out to application clients at
  scale (change-data-capture → realtime fan-out).
- **AI Transport (AIT)** — durable session infrastructure for AI apps: model
  streams survive reconnects, a session spans multiple devices, and any
  participant can signal any other through the same session. It fixes what raw
  HTTP streaming breaks in production: resume, multi-device, and bidirectional
  control.

## Core realtime concepts

- **Channels** organize traffic; **namespaces** (channel rules) set per-channel
  behaviour like message persistence and server-side batching.
- **Presence** — enter / update / leave / subscribe to know who's on a channel;
  **occupancy** gives aggregate counts (connections, subscribers).
- **History** retrieves past messages on a channel; **rewind** replays the last N
  (or a recent time window) at the moment a client attaches.
- **Connection state recovery** resumes a briefly-dropped connection and replays
  missed messages; the `resumed` flag signals continuity was preserved.
- **Messages** carry a `name`, `data`, `clientId` and a server `timestamp`;
  ordering is preserved per channel.
- **Auth** — **basic** auth (an API key, server-side only) or **token** auth
  (Ably tokens, JWTs, or token requests) so the key never reaches the client.
  **Capabilities** scope exactly what a token may do, per channel.

## What makes Ably distinctive

- A global edge network of datacentres with automatic routing and regional
  failover, engineered around the four pillars of dependability: **performance**,
  **integrity** (ordering + exactly-once delivery via idempotency), **reliability**
  (guaranteed delivery), and **availability**.
- Contractual uptime SLAs and elastic scale to millions of concurrent
  connections on a single channel/app.

## Quiz-handy specifics

- LiveObjects data types are **LiveMap** and **LiveCounter**.
- Billing is message-based, and "what counts as a message" spans every product —
  Pub/Sub, Chat, LiveObjects, Spaces and LiveSync.
- Server-side **batching** on a namespace coalesces a burst of publishes into
  fewer delivered messages (this quiz uses it on its answers channel).
- Integrations come in two directions: **inbound** (external services → Ably
  channels) and **outbound streaming** (Ably → external systems such as Kafka,
  webhooks and serverless functions).
