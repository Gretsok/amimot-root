# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Read `AGENTS.md` too.** It's this repo's detailed, actively-maintained agent
> guide (architecture internals, testing gotchas, socket/permission patterns).
> This file is the quick-reference layer on top of it. If you learn something
> that would mislead a future agent, update `AGENTS.md` (the source of truth),
> not just this file.

## What this is

Amimot is a browser party/word game (Gartic-Phone-like). Two independent
Node/React apps (`backend`, `frontend`) plus a thin root repo wiring them
together for Docker Compose. Gameplay is a full engine: 7 rounds × 5 phases
(préparation → proposition → résolution → récap → achat/shop), trap words
("mots-pièges"), constraint cards, scoring, a coin economy, a card shop.

## Repo layout — THREE separate git repos, not one

```
amimot-root/            (root repo)
├── config/game-defaults.json   # shared runtime config, mounted read-only into backend
├── deploy/                      # prod Caddyfile, smoke-test.sh, logrotate config
├── docs/                        # RGPD/compliance docs, deployment runbooks
├── docker-compose*.yml
├── backend/             # git submodule → git@github.com:Gretsok/amimot-backend.git
└── frontend/            # git submodule → git@github.com:Gretsok/amimot-frontend.git
```

`backend/` and `frontend/` are real git submodules. A change inside either
needs **two commits**: one inside the submodule, then one in the root repo
that bumps the submodule pointer (`git add backend` or `frontend` from root,
then commit). `git status`/`git log` from root only shows the root repo —
check `cd backend && git status` (or `frontend`) separately. Only commit
when explicitly asked; when you do, remember the submodule pointer bump.

## Commands

**Root — full stack via Docker (dev, hot-reload, HTTP only):**
```bash
cp .env.example .env            # first time only
docker compose up -d --build    # loads docker-compose.yml + docker-compose.override.yml automatically
```

**Root — prod-equivalent stack (static build, no hot-reload, Caddy/TLS):**
```bash
docker compose -f docker-compose.yml up -d --build
```
On the real VPS, prod also layers `docker-compose.prod.yml` (bind-mounts
`deploy/Caddyfile.prod`, remaps the published port to `127.0.0.1:8081`):
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```
An env var change requires `--force-recreate <service>`, not just `restart`
— `restart` doesn't reload environment values.

**Backend** (`cd backend`):
```bash
npm run dev                     # nodemon, http://localhost:3000
npm test                        # jest --runInBand (see gotcha below)
npx jest path/to/file.test.js   # single file
npx jest -t "test name"         # single test by name
```
`--runInBand` is required — integration tests share real state and race if
parallelized. **5 files need a real Postgres on `localhost:5433`**
(`account.service.test.js`, `account.routes.test.js`, `auth.routes.test.js`,
`rgpd-purge.job.test.js`, `tests/helpers/prisma-test-utils.js`); without it
each hangs ~60s on a Prisma timeout before failing — `npm test` can look
"stuck" for minutes when it's just working through those five files.
Spin up the test DB once:
```bash
docker run -d --name amimot-test-postgres \
  -e POSTGRES_USER=amimot -e POSTGRES_PASSWORD=amimot -e POSTGRES_DB=amimot_test \
  -p 5433:5432 postgres:16-alpine
cd backend && npx prisma migrate dev --name init
```
To iterate on gameplay-engine logic without that DB running:
```bash
npx jest --testPathIgnorePatterns=account.service.test.js \
         --testPathIgnorePatterns=account.routes.test.js \
         --testPathIgnorePatterns=auth.routes.test.js \
         --testPathIgnorePatterns=rgpd-purge.job.test.js
```

**Frontend** (`cd frontend`):
```bash
npm run dev                     # vite, http://localhost:5173
npm run lint                    # oxlint
npm test                        # vitest run
npx vitest run path/to/file.test.jsx   # single file
```

**E2E** (root, Playwright — covers frontend + backend + realtime together):
```bash
npm run test:e2e
npm run test:e2e:ui
```

There's no single command that runs backend + frontend + e2e together — run
each separately.

## Architecture (backend)

Domain-driven, **in-memory state — no database involved in gameplay**.
Postgres/Prisma exist only for the auth system (accounts, Google OAuth,
RGPD data). Room/game state live in two stores:

- `backend/src/stores/rooms.store.js` — room/player lifecycle (lobby,
  join/leave, host transfer, disconnect grace periods).
- `backend/src/stores/gamestate.store.js` — per-active-game state: `public`
  (broadcast to everyone) and `private` (per-player: hand, trap word,
  proposal — permission-gated reads).

Pure domain logic (`backend/src/domain/game/`, no I/O): `letter-picker.js`,
`normalize.js` (accent/case-insensitive word comparison), `dictionary.js`
(stub — `wordExists()` always `true`, real dictionary integration is a known
gap), `constraints.js`, `hand.js`, `scoring.js`, `phase.machine.js`.

Impure orchestration lives in
`backend/src/domain/timers/phase-timer.manager.js` — starts rounds, advances
phases on timer/activity, calls `scoring.js`. A `phaseVersion` counter makes
timer callbacks idempotent (same pattern in `grace-period.manager.js` for
disconnects).

**Permission model**: every gameplay mutation goes through
`backend/src/domain/permissions/policy.js#can(actor, action, context)`,
backed by declarative rules in `rules.js`. `SYSTEM_ACTOR` is a sentinel for
internal orchestration only (never reachable from a socket handler) that
bypasses actor-identity checks but is still subject to the rule functions.
**Never add a state mutation without a corresponding rule in `rules.js`.**

**Socket events** (`backend/src/sockets/handlers/*.handlers.js`): one
pattern throughout — `requireSocketPlayer(socket)` → call store/manager
(permission-checked internally) → broadcast **full state, never a patch**
via `game:publicStateUpdated` / `game:privateStateUpdated` →
`respondOk`/`respondError`.

**Config**: every tunable (phase durations, scoring, coin amounts, card
catalog, disconnect grace periods...) lives in `config/game-defaults.json`,
schema-validated fail-fast by `backend/src/config/index.js`. Tests use
`backend/tests/fixtures/valid-config.json` — keep the schema and both JSON
files in lockstep on any key change.

## Architecture (frontend)

React + Vite. `frontend/src/contexts/GameContext.jsx` holds room state,
public game state, and `myGameState` (private per-player state) — always
replaced wholesale, never merged, mirroring the backend's broadcast pattern.
`frontend/src/hooks/useGamePhase.js` is the single hook phase screens use for
state + actions — a new `GameContext` action must be threaded through this
hook too or components can't see it.

`frontend/src/screens/Game/GameScreen.jsx` dispatches on `gameState.phase`
to one screen per phase (`PreparationPhase`, `PropositionPhase`,
`ResolutionPhase`, `RecapPhase`, `ShopPhase`, `EndGameRanking`), each
co-located with its `.module.css` and `.test.jsx`.

Reconnection: a `sessionToken` in `sessionStorage` drives an automatic
`room:reconnect` on mount (`GameContext.jsx`), recovering public + private
state in one round trip — resumed phase comes from server state, never
client-side guessing.

## Deployment notes

- Public-facing edge in prod is Caddy (`frontend` container), fronted on the
  real VPS by a host-level nginx (Certbot-managed TLS) reverse-proxying to
  `127.0.0.1:8081` — this layer lives outside the repo, on the VPS itself.
  `deploy/Caddyfile.prod` is what's actually bind-mounted in prod, **not**
  `frontend/Caddyfile` (that one only applies to the plain
  `docker-compose.yml` image-baked path, e.g. local "prod-equivalent" runs).
  Any Caddy-level fix must go in `deploy/Caddyfile.prod` to take effect on
  the VPS.
- `backend` enables `helmet()`, which already sets HSTS on `/api/*`
  responses — don't duplicate that header at the Caddy level for proxied
  routes, only for the static `file_server` `handle` block, or clients see
  it twice.
- `deploy/smoke-test.sh` (run per `docs/verification-post-deploiement.md`)
  hardcodes container names assuming Compose project name `amimot`; if the
  actual project directory name differs (e.g. `amimot-root`), container-name
  checks in that script false-negative even though everything is healthy —
  verify with `docker inspect <real-container-name>` before trusting those
  specific failures.
- SMTP (OVH, `ssl0.ovh.net:587`) is optional at the `docker-compose.yml`
  level — unset `SMTP_HOST` leaves the mailer inert (logs instead of
  sending); see `docs/ovh-email-setup.md` for credential setup.

## Conventions to follow

- **TDD is the norm, not a suggestion** — add tests alongside (not after)
  any behavior change, and update tests that encode the *old* behavior
  rather than leaving them contradicting new code.
- Comments in this codebase are in **French** and explain **why**, never
  what — match whatever the surrounding file already uses.
- Config over hardcoding: a number affecting gameplay balance/timing almost
  certainly belongs in `config/game-defaults.json` + its schema, not inline.
- Don't leave a config field, function parameter, or branch that nothing
  reads anymore — delete it everywhere (schema, config files, call sites,
  tests), don't strand it "just in case".
