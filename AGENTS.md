# AGENTS.md — working guide for coding agents

This file is for AI coding agents (Claude Code, Codex, etc.) working in this
repo. `README.md` is the human-facing setup doc (in French) and is currently
stale in a couple of places — this file is the source of truth for how the
codebase is organized and how to work in it safely. Update this file, not
just `README.md`, whenever a change here would mislead a future agent.

## What this is

Amimot is a browser party/word game. Two independent Node/React apps
(backend, frontend) plus a thin root repo that wires them together for
Docker Compose deploys. The gameplay is a full engine: 7 rounds × 5 phases
(préparation → proposition → résolution → récap → achat/shop), trap words
("mots-pièges"), constraint cards, scoring, a coin economy, and a card shop.

## Repo layout — THREE separate git repos, not one

```
Amimot/                 (root repo — you are here)
├── config/game-defaults.json   # shared runtime config, mounted read-only into the backend container
├── docker-compose*.yml
├── backend/             # git submodule → git@github.com:Gretsok/amimot-backend.git
└── frontend/            # git submodule → git@github.com:Gretsok/amimot-frontend.git
```

`backend/` and `frontend/` are **real git submodules** (`.gitmodules` at
root). The root repo only tracks *which commit* of each submodule is
checked out. This means:

- A change inside `backend/` or `frontend/` needs **two commits**: one
  inside the submodule itself, then one in the root repo that bumps the
  submodule pointer (`git add backend` from root, then commit).
- Running `git status`/`git log` from the root only shows the root repo.
  `cd backend && git status` (or `frontend`) shows that submodule's own
  history — check both when you need the full picture.
- Pushing requires pushing the submodule's own remote first, then the root
  repo's remote. Both remotes are SSH; whether a push succeeds depends on
  the *user's* SSH key being loaded, not the agent's.
- `README.md` (root) still says submodules "haven't been finalized yet" —
  that's stale, ignore it; `.gitmodules` + `git submodule status` are the
  actual truth.

## Architecture (backend)

Domain-driven, in-memory state — **no database is involved in gameplay**.
Postgres/Prisma exist only for the auth system (accounts, Google OAuth).
Room state and game state live entirely in memory in two stores:

- `backend/src/stores/rooms.store.js` — room/player lifecycle (lobby,
  join/leave, host transfer, disconnect grace periods). Survives across
  games in the same room.
- `backend/src/stores/gamestate.store.js` — everything gameplay-specific
  per active game: `public` state (broadcast to everyone) and `private`
  state (per-player: hand, trap word, proposal — permission-gated reads).

Pure domain logic lives under `backend/src/domain/game/` (no I/O, easy to
unit test): `letter-picker.js`, `normalize.js` (case/accent-insensitive word
comparison), `dictionary.js` (stub — `wordExists()` always returns `true`,
real dictionary integration is a known gap), `constraints.js` (constraint
cards + auto-cancellation rules), `hand.js`, `scoring.js`, `phase.machine.js`.

Impure orchestration (timers, phase transitions, broadcasts) lives in
`backend/src/domain/timers/phase-timer.manager.js` — this is the one file
that "runs the game": starts rounds, advances phases on a timer or on
player activity, calls into `scoring.js` at the end of résolution, etc. A
`phaseVersion` counter makes timer callbacks idempotent (a stale timer that
fires after a manual transition already happened is a no-op) — the same
pattern used by `grace-period.manager.js` for disconnect handling.

**Permission model**: every gameplay mutation goes through
`backend/src/domain/permissions/policy.js#can(actor, action, context)`,
backed by declarative rules in `rules.js` (e.g. `SUBMIT_PROPOSITION` only
during `PROPOSITION` phase for an in-game player). There's a `SYSTEM_ACTOR`
sentinel used only by internal orchestration (never reachable from a socket
handler) that bypasses actor-identity checks but is still subject to the
same rule functions. **Never add a new state mutation without a
corresponding rule in `rules.js`** — this is the only enforcement point.

**Socket events** (`backend/src/sockets/handlers/*.handlers.js`) follow one
pattern throughout: `requireSocketPlayer(socket)` → call the store/manager
(which checks permissions internally) → broadcast full state (not a patch)
via `game:publicStateUpdated` / `game:privateStateUpdated` → `respondOk`/
`respondError`. State broadcasts are always **full-state-replace**, never a
merge — nested arrays (constraints, reveal order) can't be patched safely
by a shallow merge, and payloads stay small anyway.

**Config**: every tunable number (phase durations, scoring values, coin
amounts, card catalog, disconnect grace periods...) lives in
`config/game-defaults.json`, loaded and schema-validated (fail-fast) by
`backend/src/config/index.js`. Tests use their own copy at
`backend/tests/fixtures/valid-config.json` — **the schema validator and
both JSON files must be kept in lockstep** whenever a config key is added,
renamed, or removed.

## Architecture (frontend)

React + Vite. `frontend/src/contexts/GameContext.jsx` holds room state,
public game state, and a `myGameState` slice (private per-player state from
`game:privateStateUpdated`) — always replaced wholesale on update, never
merged, mirroring the backend's broadcast pattern. `frontend/src/hooks/
useGamePhase.js` is the single hook phase screens use to reach both state
and actions — when you add a new gameplay action to `GameContext`, it must
also be threaded through this hook or components can't see it (easy to
forget; grep for an existing action name in both files to see the pattern).

`frontend/src/screens/Game/GameScreen.jsx` dispatches on `gameState.phase`
to one screen component per phase (`PreparationPhase`, `PropositionPhase`,
`ResolutionPhase`, `RecapPhase`, `ShopPhase`, `EndGameRanking`), each
co-located with its `.module.css` and `.test.jsx`.

Reconnection: a `sessionToken` in `sessionStorage` drives an automatic
`room:reconnect` attempt on mount (see the effect in `GameContext.jsx`),
which recovers both public and private state in one round trip — the
resumed phase is derived from server state, not client-side guessing.

## Testing

**Backend** (Jest, `cd backend && npm test` — runs `jest --runInBand`,
required because integration tests share real state):

- Most of the suite (domain unit tests, permission tests, socket
  integration tests using an in-memory server) needs **no external
  services** and runs in well under a minute.
- **5 files need a real Postgres test database on `localhost:5433`**:
  `tests/integration/services/account.service.test.js`,
  `tests/integration/rest/account.routes.test.js`,
  `tests/integration/rest/auth.routes.test.js`,
  `tests/integration/jobs/rgpd-purge.job.test.js`, and the shared
  `tests/helpers/prisma-test-utils.js`. If that database isn't running,
  each test in those files hangs for ~60s on a Prisma connection timeout
  before failing — a full `npm test` can look "stuck" for several minutes
  when it's really just working through those five files. See the root
  `README.md` "Tests" section for how to spin up that Postgres container.
  To verify gameplay-engine changes quickly without it:
  ```bash
  npx jest --testPathIgnorePatterns=account.service.test.js \
           --testPathIgnorePatterns=account.routes.test.js \
           --testPathIgnorePatterns=auth.routes.test.js \
           --testPathIgnorePatterns=rgpd-purge.job.test.js
  ```
- Test conventions worth reusing rather than reinventing:
  - `backend/tests/helpers/build-test-server.js` / `socket-test-utils.js`
    spin up a real Socket.io server + client pair for integration tests.
  - For anything that crosses several phase transitions (especially
    reaching a terminal phase like `ENDED`), prefer a **polling** wait
    (repeated `game:requestState` + short sleep) over a one-shot
    `socket.once(event)` listener — a push-based wait can race-miss the one
    broadcast that matters, after which nothing ever "rescues" it. Several
    existing test files (`gameplay-edge-cases.test.js`,
    `disconnection-reconnection.test.js`) have a `waitForPhase` helper doing
    exactly this — reuse it rather than writing a new `waitForEvent`.
  - `pickLetter`/`pickRandomCard` accept an injectable `rng` (default
    `Math.random`) specifically so tests can force a deterministic draw —
    follow this pattern for any other future randomness in `domain/`.

**Frontend** (Vitest + Testing Library, `cd frontend && npm test`): full
suite, no external dependencies, runs in a few seconds. Components mock
`useGamePhase()` directly rather than rendering through the real
`GameContext` — see any existing `*.test.jsx` under `screens/Game/` for the
pattern.

There is currently no single command that runs both suites together — run
them separately in each submodule.

## Conventions to follow

- **TDD is the norm here**, not a suggestion — the existing test suite was
  built test-first and stays green; add tests alongside (not after) any
  behavior change, and update the tests that encode the *old* behavior
  rather than leaving them contradicting the new code (this has bitten
  agents before: a test literally asserted the behavior a later fix was
  meant to reverse).
- Comments in this codebase are in **French**, and explain **why**, never
  what (identifiers are already descriptive English/French mix — follow
  whatever the surrounding file already uses). Don't add a comment that
  just restates the line below it.
- Config over hardcoding: if you're about to hardcode a number that affects
  gameplay balance or timing, it almost certainly belongs in
  `config/game-defaults.json` + the config schema instead.
- Don't leave a config field, function parameter, or code branch that
  nothing reads anymore — e.g. when a scoring rule changed to make a
  multiplier dead, it was deleted (schema, config files, call sites, tests)
  rather than left unused.
- Only commit when explicitly asked to. When you do, remember the
  submodule two-step above — a task isn't fully committed until the root
  repo's submodule pointer is bumped too.
