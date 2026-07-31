# Amimot — UX/UI Audit Follow-up (2026-07-31)

This is a second, independent pass on the Amimot frontend, done after the first audit's (`docs/ux-ui-audit-2026-07.md`) recommendations were implemented. It has two goals: verify each of the 8 prior fixes actually holds up in the current code, and do a genuinely fresh sweep — including files the first pass barely touched — for anything new.

## Executive summary

Seven of the eight prior fixes hold up well under a fresh look, including two edge cases worth specifically calling out as correct: the responsive breakpoint transitions cleanly at exactly 768px with no layout glitch, and the ready-count denominator correctly excludes an observer who joins mid-round. `EndGameRanking` — unreachable in the first audit without playing 7 full rounds — was reached this time via a temporary local config change and renders cleanly, including correct tied-rank display.

The eighth fix, however, introduced a **real regression that should be fixed before anything else here**: `Modal`'s new focus-trap effect steals keyboard focus away from any text field inside it on every keystroke, whenever the modal's `onClose` prop isn't a stable (memoized) function reference — which is exactly how both real consumers with text inputs (`ConstraintCard`'s letter/number popup, `ProfileOverlay`'s pseudo editor) currently call it. This was confirmed live: typing multiple characters into either field only registers the first one. This is worse than the original "no focus trap at all" state for these two screens, because now the input is actively unusable rather than merely inaccessible to keyboard-only/screen-reader users.

## Fixes verified (against the first audit's 8 items)

| # | Finding | Status |
|---|---|---|
| 1 | Responsive desktop/tablet layout | **Confirmed good.** Checked the exact 768px boundary (767px vs. 768px side by side) — the Home card widens from 440px→560px cleanly, no jump/overlap. Lobby's new `.content` wrapper caps content sensibly at all three checked widths (767/768/1024). |
| 2 | Modal accessibility (`role`, `aria-modal`, Escape, focus trap) | **Partially regressed — see headline finding above.** `role="dialog"`/`aria-modal="true"` are present and correct. Escape-to-close still works. Tab-cycling was re-verified this round and correctly wraps within the panel (8-Tab sequence on the 5-element Auth modal cycles with the expected period). But the focus-trap `useEffect`'s dependency on a non-memoized `onClose` (`Modal.jsx:50`) breaks typing in the two modals that contain a live-updating text field. |
| 3 | Ready-count indicator | **Confirmed good, including an edge case.** A solo `IN_GAME` player shows "0/1 validé·e·s"; when a second player joins **mid-round** (becoming an `OBSERVER`, not `IN_GAME`), the denominator correctly stays at 1, not 2 — matches the backend's own `activeInGamePlayerIds` filter. |
| 4 | Disconnect indicator on `PlayerChip` | **Confirmed present**, but see new finding below re: contrast. |
| 5 | Semantic design-system colors | **Confirmed.** `--color-danger`/`--color-success`/`--color-warning` present in `tokens.css`, correctly consumed by `PhaseTimer.module.css:20`'s `.urgent` class and the error-text classes. |
| 6 | `TextInput:disabled` style, `RoomCodeBadge`/`GameSettingsPanel` kit usage | **Confirmed visually** (dimmed disabled input, ghost-styled action buttons, labeled number input) — see new findings below for two things introduced alongside this fix. |
| 7 | `Button variant="link"` + dedupe | **Confirmed present** in `HomeScreen.jsx`/`AuthOverlay.jsx`. See new finding below — a latent CSS bug, not currently visible. |
| 8 | `ProfileOverlay` delete-confirmation via `Modal` instead of `window.confirm` | **Present, but inherits the headline focus-steal bug** when editing the pseudo field in the same overlay. |

## New findings

### 1. [Critical] Modal's focus trap steals focus from text inputs on every keystroke

`components/ui/Modal.jsx:17-50` — the focus-trap effect depends on `[open, onClose]`. `ConstraintCard.jsx:61` passes `onClose={() => setOpen(false)}` (a new function every render) around a `TextInput` (lines 65-83); `ProfileOverlay.jsx`'s `handleClose` is similarly a plain, non-memoized function around its pseudo `TextInput`. Both components re-render on every keystroke (local `useState` for the field value), so the effect tears down and rebuilds on each one: cleanup refocuses whatever was focused *before the modal opened* (`Modal.jsx:48`), then re-init immediately moves focus to the panel `div` itself (`Modal.jsx:21`) — never back to the field.

**Verified live** with continuous typing (not per-character `.press()`, which auto-focuses and would mask this): typing `"12"` into a `MAX_LENGTH`/`MIN_LENGTH` constraint card's number field left the value at `"1"`; typing `"NouveauPseudo"` into `ProfileOverlay`'s pseudo field left it at `"N"`.

**Fix direction**: stop depending on `onClose` identity — store it in a `ref` updated every render (`onCloseRef.current = onClose`) and call `onCloseRef.current()` from the Escape handler, with the effect's dependency array reduced to `[open]`.

### 2. [Minor, latent] `Button variant="link"` + `:disabled` cascade bug

`Button.module.css:63-68`'s `.button:disabled` unconditionally sets `box-shadow: var(--shadow-md)`. A pseudo-class selector (specificity 0,2,0) beats the single-class `.link` variant's `box-shadow: none` (0,1,0), so a disabled link-styled button would wrongly gain a hard offset shadow, contradicting its flat/underlined look. Not currently triggered — grepped every `variant="link"` usage (`HomeScreen.jsx:92,96`, `AuthOverlay.jsx:63`) and none pass `disabled` — but real the first time one does (e.g. a submit-in-progress state on the "Pas encore de compte" toggle).

### 3. [Minor] Disconnected `PlayerChip` may be hard to read

`PlayerChip.module.css:40-42` dims the whole chip via `opacity: 0.5`. Chips render on the dark game-phase gradient background (`GameScreen.module.css:3-4`), so halving opacity fades the ink text *and* the already-borderline-contrast `.offlineBadge` text (`color: var(--color-muted)`, line 46) simultaneously, rather than just visually "graying out" the player. Worth a second look — e.g. dim only the avatar, or keep text at full opacity and rely on the "Déconnecté" label + a muted (not transparent) chip background instead.

### 4. [Minor] `GameSettingsPanel`'s settings update has no error feedback

`GameSettingsPanel.jsx:34` — `onClick={() => onUpdateSettings({ maxPlayers })}` has no try/catch or `showError`, unlike every other mutating handler touched in the same kit-consistency pass (`PreparationPhase`, `PropositionPhase`, `EndGameRanking`, `GameScreen` all wrap their calls). If updating max-players fails (e.g. permission edge case), the host gets zero feedback.

### 5. [Minor] `GameSettingsPanel.module.css`'s `.editRow input` selector is fragile

A descendant selector (`.editRow input`, `GameSettingsPanel.module.css:33-40`) assumes `TextInput` always renders a bare `<input>` and that nothing else input-bearing is ever placed in `.editRow`. Works today; a `data-*` attribute or a compact-size prop on `TextInput` would be more robust against future changes.

### 6. [Minor] No test coverage for the new `ReadyCount` component

No `ReadyCount.test.jsx` exists (confirmed by glob). Its `total <= 0` guard (returns `null` for an observer-only room) and the ready/total text rendering have no dedicated unit test — only indirectly exercised via `PreparationPhase.test.jsx`/`PropositionPhase.test.jsx`.

### 7. [Minor] Two adjacent `aria-live="polite"` regions during Preparation/Proposition

`ReadyCount.jsx:9` and `PhaseTimer.jsx:14` (from the first round of fixes) are both `aria-live="polite"` and sit next to each other. `PhaseTimer` updates every second; a screen-reader user would likely hear it interrupt or compete with `ReadyCount`'s announcements. Consider making the timer's live region less chatty (e.g. only announce at specific thresholds) rather than every tick.

### 8. [Confirmed working] `EndGameRanking`, live-verified for the first time

Not reachable in the first audit without completing 7 rounds. This time, verified by temporarily setting local config to a single round (`config/game-defaults.json`, reverted immediately after — confirmed via `git diff` that only the pre-existing unrelated local change remains). Renders cleanly: correct "sportive" tied-rank display (both players at -2 pts both showed rank "1"), consistent styling with the rest of the kit, `PlayerChip` renders correctly inside the ranking list.

### 9. [Minor] `ConstraintCard`'s destroy-constraint flow

`ConstraintCard.jsx:39-41` — confirming a `DESTROY_CONSTRAINT` card with no `targetId` selected silently no-ops (the modal just stays open) with no message explaining why nothing happened. Separately, the radio group (lines 85-102) has no `<fieldset>`/`<legend>`, so screen readers won't announce it as a group of related options.

### 10. [Minor] No request/ack timeout anywhere in the network layer

`services/api.js:1-16`'s `request()` has no timeout/abort handling, and `services/socket.js:14-26`'s `emitAsync` has no timeout on the ack callback either. If a request hangs or the server never acks (dropped connection, server hiccup), every `try { await X() } catch { showError }` pattern used throughout the screens simply never resolves — the UI is stuck with no error and no "still working…" affordance. This affects every mutating action in the app (create/join room, submit word, buy card, etc.).

### 11. [Minor] Unguarded clipboard write

`RoomCodeBadge.jsx:8-9` — `navigator.clipboard.writeText(...)` isn't wrapped in a try/catch. On a non-secure context or a permission denial, the promise rejects unhandled and the "Copié !" confirmation just silently never appears, with no fallback (e.g. a manual "select the code" affordance).

### Clean areas (no issues found)

`ConstraintsList.jsx`, `useAuth.js`, `utils/storage.js` — all read cleanly, no UX/UI concerns.

## Prioritized recommendations

1. **Fix the Modal focus-steal bug** (finding 1) — highest priority by far; it makes two real forms hard to use, a regression introduced by this round's own accessibility work.
2. **Add a request/emit timeout** (finding 10) with a "something went wrong, try again" fallback — affects every mutating action in the app if the network hiccups.
3. **Re-evaluate the disconnected-chip dimming** (finding 3) for contrast, and **add error handling to `GameSettingsPanel`'s update call** (finding 4) — both quick, contained fixes.
4. Everything else (findings 2, 5, 6, 7, 9, 11) — low-urgency polish, safe to batch whenever convenient.
