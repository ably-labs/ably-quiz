# S1 gate — auth e2e

Proves the `/api/ably-auth` JWTs authenticate against **real Ably** and enforce
the §B2.5 capability matrix. Drives the actual quiz paths.

```sh
# 1. build + run the web server (loads apps/web/.env.local → repo-root .env.local)
pnpm --filter @ably-quiz/web build
pnpm --filter @ably-quiz/web exec next start -p 3100 -H 127.0.0.1 &

# 2. run the checks (override host/port with AUTH_BASE_URL if needed)
pnpm --dir spikes/auth-e2e verify
```

Checks:

- host token → `h:` clientId; player token → `p:` clientId.
- a player **cannot** mint a host token (403 without `HOST_KEY`).
- **control broadcast**: host publishes on `quiz:dev`, a player receives it (question path).
- **fan-in**: a player publishes to `quiz-answers:dev`, the host (sole subscriber) receives it.
- **capability denial**: a player publishing to `quiz:dev` is rejected (`40160`).

Reads `HOST_KEY` from the repo-root `.env.local`. Needs the app namespaces from
[docs/ABLY-SETUP.md](../../docs/ABLY-SETUP.md).
