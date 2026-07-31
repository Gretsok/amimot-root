# E2E tests

Playwright suite covering the whole application (frontend + backend + realtime) running together. Lives at the repo root rather than inside `backend/` or `frontend/` because it exercises both together — see `AGENTS.md` for why those are separate repos.

## Prerequisites

1. **`backend/` and `frontend/` dependencies installed** (`npm install` in each — not done automatically by this suite).
2. **The dedicated test Postgres running**, same one the backend's own integration tests use:
   ```bash
   docker start amimot-test-postgres
   ```
   If it doesn't exist yet, create it once (from the root `README.md`'s "Tests" section):
   ```bash
   docker run -d --name amimot-test-postgres \
     -e POSTGRES_USER=amimot -e POSTGRES_PASSWORD=amimot -e POSTGRES_DB=amimot_test \
     -p 5433:5432 postgres:16-alpine
   cd backend && npx prisma migrate deploy
   ```
3. **Chromium installed for Playwright** (one-time): `npx playwright install chromium`.

## Running

```bash
npm run test:e2e          # headless run
npm run test:e2e:ui       # interactive UI mode, great for debugging a single spec
npm run test:e2e:report   # opens the HTML report from the last run
```

`playwright.config.js`'s `webServer` array starts the backend (`node backend/src/server.js`, pointed at the test Postgres and at `e2e/fixtures/game-defaults.e2e.json` — short phase durations, 1 round, so tests don't need real-time waits) and the frontend (`npm run dev` in `frontend/`, Vite's default port 5173) automatically, and tears them down after. Locally, if either is already running on its expected port, the suite reuses it instead of starting a second copy (`reuseExistingServer`); CI always starts fresh.

## What's covered

- `home-and-lobby.spec.js` — create/join a room, invalid code error, room code reveal/copy, kick, settings update, leave.
- `auth.spec.js` — register, login, wrong-password/duplicate-pseudo inline errors, profile update, account deletion (via the shared `Modal`, not `window.confirm`), logout.
- `gameplay-round.spec.js` — a full round (Preparation → Shop) for two players, the ready-count indicator, playing a constraint card.
- `disconnect-reconnect.spec.js` — the disconnected-player indicator, and that reloading restores the reconnecting player's own state.
- `end-of-game.spec.js` — reaching `EndGameRanking` and returning to the Lobby.
- `accessibility.spec.js` — Modal Escape/Tab-cycling, and a permanent regression test for the focus-steal bug fixed in the UX/UI audit follow-up (`docs/ux-ui-audit-2026-07-followup.md`).
- `responsive.spec.js` — layout at the 768px breakpoint boundary and other widths.

**Not covered** (documented gap, not an oversight): real Google OAuth — it needs a live Google account/consent screen and isn't something a black-box browser test can exercise.
