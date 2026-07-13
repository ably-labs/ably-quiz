# Ably — shared study digest

Baseline grounding injected into every agent's system prompt at answer time
(BRIEF §B2.7 step 4). Concise on purpose; the fuller, doc-scraped notes live in
each agent's `crib.md` (from `pnpm agents:study`). Facts verified against
https://ably.com/llms.txt on 2026-07-13.

Ably is a realtime experience infrastructure platform built on a global,
low-latency, highly-available pub/sub messaging network.

## Core Pub/Sub concepts

- **Channels** organize message traffic — clients publish to and subscribe to named channels.
- **Presence** lets clients be aware of other clients present on a channel (enter, update, leave, subscribe).
- **History** gives access to past messages on a channel; **rewind** replays recent messages on attach.
- **Connection state recovery** resumes a connection and replays missed messages after a brief drop.

## Products

- **Pub/Sub** — the core realtime pub/sub messaging product (channels, presence, history).
- **Chat** — purpose-built chat: rooms, messages, reactions, typing indicators, occupancy.
- **Spaces** — build collaborative, multiplayer environments (member location, live cursors, component locking).
- **LiveObjects** — realtime state synchronization via conflict-free data structures: **LiveMap** and **LiveCounter**.
- **LiveSync** — synchronize changes in your database out to application clients at scale.
- **AI Transport (AIT)** — durable session infrastructure for AI applications: streams survive reconnects, sessions span devices, and any participant can signal any other through the same session.

## Handy specifics

- Ably SDKs authenticate with either an API key (server-side) or token auth (client-side; keeps the key off the client).
- Messages carry a `name`, `data`, `clientId`, and a server `timestamp`.
- Channel rules (namespaces) enable per-channel features such as message persistence and server-side batching.
