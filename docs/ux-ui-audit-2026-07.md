# Amimot — UX/UI Audit (2026-07-31)

## Executive summary

Amimot's frontend is visually further along than the "squelette technique" label in the README suggests: the "cartoon flat / bouncy" design system from `Charte Graphique/` is implemented faithfully and consistently (colors, radii, offset hard shadows, Fredoka/Poppins), no debug code or placeholder UI was found anywhere in `frontend/src`, and the shared `Button`/`TextInput`/`Modal`/`PlayerChip` kit is reused broadly. The gaps are concentrated in three areas: **zero responsive breakpoints** (the layout is a single narrow column at every viewport width, leaving desktop mostly empty space), **zero accessibility handling on overlays** (no focus trap, no `role="dialog"`, Escape does nothing — verified live), and **silent multiplayer state** (no "N/2 ready" indicator, and a disconnected player's chip looks identical to a connected one — also verified live). None of these break core functionality; they're UX-maturity gaps, not bugs in a shipped-feature sense.

## Methodology

- **Static read**: every screen/component pair under `frontend/src/{screens,components}` plus its `.module.css`, `frontend/src/theme/{tokens,global}.css`, and both `Charte Graphique/*.dc.html` mockups (there is no written style-guide prose — they are inline-styled HTML mockups of the palette, type, buttons, chips, and two full screens).
- **Live verification**: started the real stack with `docker compose up -d --build` (root `.env`, dev override → hot-reload Vite on `http://localhost:8099`), then drove it headlessly with a throwaway Playwright script (2 browser contexts = 2 simulated players) at **375×812** (mobile) and **1440×900** (desktop): Home → register/login (`AuthOverlay`) → `ProfileOverlay` → invalid-room-code error → Lobby (1 and 2 players) → Preparation → Proposition → Resolution → Recap → Shop, plus a dedicated Escape-key test on an open `Modal` and a mid-game browser-context close to observe disconnect handling. Screenshots were kept locally as evidence for this report, not committed to the repo.
- **Not exercised**: Google OAuth (needs a real Google account/consent screen), rounds 2–7 and `EndGameRanking` (reaching them requires finishing a full 7-round game — assessed from code only), RGPD data export contents.

## Findings

### 1. Design-system fidelity — Minor

`frontend/src/theme/tokens.css:8-42` maps every charte color/radius/shadow 1:1 onto CSS custom properties (mint `#3eeba8` CTA, ink `#2a1b4d` outlines/text, cream `#fff6e9` panels, the signature offset "hard" shadows). Live screenshots (Home, Lobby, all game phases) render exactly as designed. The one gap: **neither the charte nor `tokens.css` defines error/success/warning colors** — `AuthOverlay.module.css:14-18` and the resolution "trap" note simply reuse brand pink (`--color-pink`), which is visually indistinguishable from decorative/secondary-button pink elsewhere on the same screen.

### 2. Responsiveness — Major

`grep -r "@media" frontend/src` returns nothing — there are no breakpoints anywhere. Every screen/phase container caps at `max-width: 440-480px` (e.g. `HomeScreen.module.css:48`, `PreparationPhase.module.css`, `ShopPhase.module.css`) and centers via flexbox. `global.css:19-21` documents this as a deliberate choice ("Mobile-first : pas d'effets ':hover'…"), but there's no companion rule for *wide* viewports. **Verified live**: `desktop-07-lobby-solo-wide.png` (1440×900) shows the same ~440px-wide card floating in a sea of flat orange/pink background — functionally fine, but reads as unfinished on any screen wider than a phone. Two smaller related risks, also code-confirmed: `PlayerChip.module.css:31` `white-space: nowrap` on `.name` combined with a 15-char name + " HÔTE" suffix (`PlayerChip.jsx:20-23`) can overflow its flex row on narrow phones; `RoomCodeBadge.module.css:8` `min-width: 200px` is a soft risk below ~220px viewports.

### 3. Accessibility — Major

- `Modal.jsx:1-12` has no `role="dialog"`, no `aria-modal`, no focus trap, and no Escape handling — closing only works via an overlay click or an explicit in-panel button. **Verified live**: pressed `Escape` on the open Auth modal; it stayed open (`visible before: 1, after: 1`). This affects every overlay in the app: `AuthOverlay`, `ProfileOverlay`, `ErrorPopup`, and `ConstraintCard`'s in-hand config popup.
- `GameSettingsPanel.jsx:21-28` renders a raw `<input type="number">` for max players with no `<label htmlFor>`/`aria-label` — only a visually-adjacent `<div className={styles.label}>` (line 19) — so a screen reader announces an unlabeled number field.
- `TextInput.module.css:14-16` sets placeholder color to `--color-muted-light` (`#c9bee0`) on a white input background — a low-contrast pairing. **Verified live**: `mobile-09-proposition-alice.png` shows the "Ta proposition" placeholder is noticeably faint against the white field.
- No `aria-live` region exists anywhere in the codebase — `PhaseTimer.jsx` counts down silently for assistive tech, and phase transitions/score reveals are equally silent.
- What's done well: every clickable action is a real `<button>` (no `div`+`onClick`), `PlayerList.jsx:18`'s kick button has `aria-label={"Exclure " + name}`, `ConstraintCard.jsx` inputs have `aria-label`, and `EndGameRanking.jsx:43` uses a semantic `<ol>` for the ranking.

### 4. Feedback & state handling — Minor/Major mix

- **Loading = blank screen**, repeated across the app: `GameScreen.jsx:33`, `LobbyScreen.jsx:13`, `PreparationPhase.jsx:23`, `PropositionPhase.jsx:30`, `ResolutionPhase.jsx:29`, `ShopPhase.jsx:13`, `EndGameRanking.jsx:28` all `return null` while data isn't ready — no spinner or skeleton anywhere. On the fast local docker network this was a sub-second flash in every live run; on a slow mobile connection (the stated target device) it would read as a frozen/broken app. **Major** for that reason, even though it wasn't visually reproducible live here.
- `TextInput.module.css` defines no `:disabled` style at all, despite being used disabled in `PreparationPhase.jsx:84` and `PropositionPhase.jsx:92`. **Verified live**: `mobile-11-proposition-validated-alice.png` — the locked-in "OAT" input is pixel-identical to the editable state; only the button below (`Validé`, greyed via `Button.module.css:44-49`) signals anything changed. Minor, since the button still communicates the state.
- `ProfileOverlay.jsx:27` uses a native `window.confirm('Supprimer définitivement ton compte ?')` for account deletion — the one place in the app that breaks from the shared `Modal` pattern used for every other confirmation/overlay. Minor.
- Good pattern found: empty states are handled everywhere they occur — `ConstraintsList.jsx:29` "Aucune contrainte active", `ResolutionPhase.jsx:66` "Personne n'a proposé de mot cette manche."

### 5. Consistency — Minor

- `RoomCodeBadge.jsx:30-38` rolls its own `<button className={styles.actionButton}>` three times (`RoomCodeBadge.module.css:35-44`, `min-height: 36px`) instead of the shared `Button`, which standardizes on a 56px "cible tactile confortable" (`Button.module.css:11-13`). This is a real (if small) tap-target regression on the one screen (Lobby) most likely to be used one-handed while relaying a room code to a friend.
- `GameSettingsPanel.jsx:21-28`'s number input (`GameSettingsPanel.module.css:33-42`) is styled independently rather than reusing `TextInput`, and has no focus/disabled treatment of its own.
- `HomeScreen.module.css:84-93` (`.linkButton`) and `AuthOverlay.module.css:20-29` (`.switchMode`) are near-identical hand-rolled "text link" button styles (differ only in `font-size`: 0.95rem vs 0.9rem) duplicated instead of a shared `Button` "link" variant.

### 6. Multiplayer / game-flow UX — Major

- **No ready/waiting indicator** in Preparation or Proposition: once a player validates, the only feedback is their own button flipping to "Validé" (`PreparationPhase.jsx:86-89`, `PropositionPhase.jsx:94-97`). **Verified live**: `mobile-11-proposition-validated-alice.png` shows nothing about Bob's status — in a real 4-6 player game, players will have no idea why the phase hasn't advanced.
- `PhaseTimer.module.css:12-17` never changes color/size as time runs low — **verified live** (screenshots at 20s and 17s remaining are styled identically) — and isn't in an `aria-live` region.
- **Disconnection is invisible.** `PlayerChip.jsx` has no connected/disconnected visual state at all (confirmed by reading the whole file — it only ever renders avatar + name + host badge). **Verified live**: closed Bob's browser context mid-Shop-phase, waited 3+ seconds — `mobile-15-shop-alice.png` and `mobile-17-after-bob-disconnect.png` are pixel-identical from Alice's side. After the host stopped the game, the Lobby's player list (`mobile-18-lobby-after-stop.png`) still shows Bob as a normal, kickable player with no offline/greyed indicator, seconds after his tab was closed.
- `ErrorPopupContext.jsx:6-11` defines a generic `DISCONNECTED` message but only reacts to the local socket's own `connection:error` event (line 19-21) — there is no reconnect attempt and no signal when *another* player disconnects (consistent with the previous point).
- **Two different error-surfacing patterns** depending on screen: the global `ErrorPopup` modal (**verified live**: "Cette room n'existe pas (ou plus)." on an invalid room code) versus an inline `<p className={styles.error}>` in `AuthOverlay`/`ProfileOverlay` forms (**verified live**: "Ce pseudo est déjà pris." rendered inline, with the modal itself staying open).
- Good pattern found: `GameScreen.jsx:54-58`'s observer note ("Tu observes cette partie déjà commencée…") is the one place mid-game status is proactively communicated.

## Prioritized recommendations

Roughly ordered by impact-for-effort, not raw severity:

1. **Add a per-player ready/progress indicator** to Preparation and Proposition (e.g. "3/5 validé·e·s" next to the timer). Small, high-impact — this is the single change most likely to reduce real-player confusion, and the data (`room.players`, each player's validation flag) already reaches the client.
2. **Give `Modal` baseline accessibility**: `role="dialog"`, `aria-modal="true"`, an Escape-key handler, and focus moved into the panel on open. One shared component fix cascades to five+ overlays at once.
3. **Surface player connection state on `PlayerChip`** (e.g. a dimmed avatar + "déconnecté" label using existing grace-period state the backend already tracks per `AGENTS.md`'s disconnect/reconnect design). Directly fixes the disconnect-invisibility finding.
4. **Add a real desktop layout pass** (or explicitly confirm out of scope — see open question below): even a simple `@media (min-width: 720px)` breakpoint that widens the card or adds side padding/branding would remove the "unfinished" impression at typical laptop widths.
5. **Style `TextInput:disabled`** and route `ProfileOverlay`'s delete-account confirmation through the shared `Modal` instead of `window.confirm` — both are small, contained CSS/JSX changes.
6. **Consolidate the two error-surfacing patterns** into one (either always the global `ErrorPopup`, or always inline) so users get a consistent mental model of "how do I know something went wrong here."
7. **Replace the ad hoc `RoomCodeBadge`/`GameSettingsPanel` markup with the shared `Button`/`TextInput` kit**, and dedupe the `.linkButton`/`.switchMode` styles into one shared "link" `Button` variant — lower urgency, mostly a maintainability/tap-target-consistency cleanup.
8. **Add urgency styling to `PhaseTimer`** (color shift under ~5s) and an `aria-live="polite"` region for the countdown/phase-transition text.

## Open questions for the user

- Is a real desktop/tablet layout in scope for now, or is Amimot intentionally play-on-your-phone-only (in which case the empty desktop space is accepted scope, not a defect)? This changes whether recommendation #4 is worth scheduling.
- Should the two Major items — **multiplayer-state visibility** (ready count, disconnect indicator) vs. **modal accessibility** — be tackled first? Both are cheap relative to their impact, but they touch different code (gameplay screens vs. the shared UI kit), so it's worth knowing which matters more before scheduling follow-up work.
- No error/success/warning colors exist in the design system at all (finding #1) — worth deciding now whether to extend the charte with a couple of semantic tokens, since the resolution/scoring screens will only grow more state-dependent color needs as the game fills out.
