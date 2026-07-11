# Testing — Carbon vs Silicon

How we prove the quiz works: an automated recovery test, manual browser
procedures for the human-facing paths, and the S3 stage-gate checklist.

Everything needs a running web server (for `/api/ably-auth`) and a real Ably
key in `.env.local`. Start it once:

```bash
pnpm --filter @ably-quiz/web dev      # http://localhost:3000
# note the port; the harness may pick another (e.g. 63095) — use it below
```

---

## 1. Recovery (S3.5) — automated

Proves that a host and a player both rejoin **mid-quiz** from Ably channel
history, exercising the exact wiring the browser uses (`loadControlHistory` /
`loadAnswerHistory` + `Quizmaster.recover`, and the player `history` capability).

```bash
AUTH_BASE_URL=http://localhost:3000 PLAYERS=4 \
  pnpm --filter ably-quiz-spike-sim recover
```

What it does:

1. Host **A** drives a quiz through Q1 reveal and into Q2 (left open), with
   synthetic players answering, then **closes its connection** (simulating a
   host tab close / serverless function death).
2. Host **B** connects fresh and rebuilds its `Quizmaster` **purely from channel
   history**. It must match A exactly: `phase`, `questionIdx`, answer-log length,
   and every player's score.
3. A **player token** reads the main channel's history and reconstructs the
   in-flight question — the same reduce `useQuizState` runs on refresh. This
   confirms the player `history` capability (§B2.5) is granted and sufficient.
4. Host B **resumes driving to podium**, proving it's a working host, not a
   read-only snapshot.

Expected tail:

```
  ✓ host recovery: phase + question index match
  ✓ host recovery: answer log length matches
  ✓ host recovery: standings (scores) match exactly
  ✓ player recovery: PLAYER token reads main history + reconstructs in-flight question
  ✓ host recovery: recovered host can resume to podium

RECOVERY PASS
```

Exit code is `0` on pass, `1` on any failed check.

---

## 2. Recovery (S3.5) — manual, real browsers

The automated test covers the engine + capabilities; this covers the actual
React hooks and the visible UX. You need the quiz created on the host machine
(the full quiz — questions + correct answers — lives in that browser's
`localStorage`; only derived state is on the wire).

**Setup**

1. Open `/` (create page), click **load samples** (localhost only), **Create quiz**.
2. Open the three links from the "quiz ready" screen:
   - **Screen** (`/screen?quiz=…`) — the projector view
   - **Host controls** (`/host?quiz=…`) — your laptop
   - **Join** (`/play?quiz=…`) — a phone or a second tab; join with a nickname
3. On host controls: **Start quiz → Next question**. The screen shows the
   question + countdown; the player sees the answer buttons.

**Host refresh mid-question**

4. With a question open, **refresh the host controls tab**.
   - ✅ Expected: the host returns to the **same phase** (e.g. "Lock answers (N
     in)") for the **same question** — not back to the lobby. Answers already in
     are still counted; you can Lock → Reveal → continue to podium normally.
   - The screen and players are unaffected throughout (their state is on the wire).

**Player refresh mid-question**

5. With a question open (phase `asking`), **refresh the player tab** and rejoin
   with a nickname.
   - ✅ Expected: the player lands straight back on the **current question** with
     answer buttons (reconstructed from history) — not a blank "waiting" screen.
   - If the question is already revealed, they see the reveal state.

**Screen refresh**

6. Refresh the `/screen` tab at any time.
   - ✅ Expected: it re-renders the current phase from LiveObjects immediately
     (lobby / question + tallies / reveal / podium), and the in-flight question
     text returns via history.

---

## 3. End-to-end question loop (S3.3) — automated

Drives a full quiz with a real host (core `Quizmaster` + the web Ably adapters)
and N synthetic players, verifying zero dropped answers through the
lock/reveal/podium cycle.

```bash
AUTH_BASE_URL=http://localhost:3000 QUIZ_ID=sim PLAYERS=5 \
  pnpm --filter ably-quiz-spike-sim sim
```

To watch it on the projector view, open `/screen?quiz=sim` first, then run the
sim — the screen fills in live and ends on the podium.

**Players-only** (an external browser host drives; the sim just answers for 120s):

```bash
AUTH_BASE_URL=http://localhost:3000 QUIZ_ID=<your-quiz> PLAYERS=5 PLAYERS_ONLY=1 \
  pnpm --filter ably-quiz-spike-sim sim
```

---

## 4. S3 stage gate

The gate is: **a full quiz with 5 real browsers + 300 synthetic players, zero
dropped answers, recovery passes.**

1. **Recovery passes** — §1 above is green (and spot-check §2 in a browser).
2. **5 real browsers** — create a quiz, join from 5 devices/tabs, play it
   through to the podium; scores and the Humans⚡Agents bar update live.
3. **300 synthetic, zero drops** — with the 5 browsers still joined, run the
   load harness (S3.6) and confirm `answers == players × questions`:

   ```bash
   AUTH_BASE_URL=http://localhost:3000 QUIZ_ID=<same-quiz> PLAYERS=300 PLAYERS_ONLY=1 \
     pnpm --filter ably-quiz-spike-sim sim
   ```

   (S3.6 tunes burst timing and confirms the S1.3 rate-limit findings; shard
   `quiz-answers:{0..n}` only if inbound limits demand it.)

---

## Unit + build gate (every commit)

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @ably-quiz/web build
```

Must be clean before every commit (§B0). Never weaken or skip a test to make it
pass — fix the code.
