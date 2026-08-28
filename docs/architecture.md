# Guerra architecture

## Overview

Guerra is a browser-based, turn-based hex strategy game with deckbuilding. The runtime has four principal layers:

```text
Browser UI and SVG renderer (`hex-grid.ts`, `hex-grid.html`)
                         │
                         │ HTTP + WebSocket
                         ▼
Authoritative match service (`server.mjs`, `server/`)
                         │
                         ▼
Deterministic rules engine (`game/`)
                         │
                         ▼
Local JSON persistence (`data/`)
```

The browser projects previews for interaction, but the server owns confirmed state and legal actions.

## Source map

### Game rules

- `game/board.ts`
  - Axial coordinate strings and validation.
  - Playable coordinates, regions, adjacency, distances, and straight lines.
- `game/cards.ts`
  - Static troop catalogue.
  - Action, trigger, passive, upgrade, and deployment definitions.
- `game/engine.ts`
  - `GameState`, units, effects, bashes, bombs, phases, and pending resolutions.
  - Legal-action generation and authoritative action application.
  - Region control and combat summaries.
- `game/types.ts`
  - Shared primitive game types such as `Player`.

The rules layer should remain deterministic and UI-independent. A rules change should normally be testable without a server or browser.

### Server

- `server.mjs`
  - HTTP server and static-file serving.
  - Login, deck, queue, match, health, and Playground endpoints.
  - WebSocket upgrade and message routing.
- `server/match-store.mjs`
  - Match creation and authoritative transitions.
  - Selection state, legal actions, match snapshots, and Playground operations.
- `server/persistence.mjs`
  - Runtime snapshots, sandbox saves, and diagnostic match logs.
- `server/user-store.mjs`
  - Nickname and deck persistence.
- `server/http-utils.mjs`
  - HTTP parsing, static MIME types, nickname cleaning, and JSON responses.

The client sends selections and actions. The server validates them against current state and broadcasts a `ServerMatchState` snapshot.

### Client support modules

- `client/protocol.ts`
  - Browser-facing server snapshot and legal-action types.
- `client/troop-view.ts`
  - Projects static card seeds and server units into display-ready troop models.
  - Produces card text, board-description rows, upgrades, and effect summaries.
- `client/deck-state.ts`
  - Pure deck-builder state operations.
- `client/board-animation-geometry.ts`
  - Pure quadratic trajectory construction and continuous tangent sampling for board projectiles.
- `client/board-animation-timing.ts`
  - Shared animation durations, sizes, segment counts, and materialization timing.
- `client/board-projectiles.ts`
  - Pure projection of authoritative effects and staged actions into stable ranged, Magic, Cannon, Gore, Bomb, and Upgrade projectile descriptors.
- `client/board-resolution.ts`
  - Pure comparison of consecutive authoritative snapshots into damage, bomb-area, replay-projectile, instant-action, bash-resolution, and legacy Gore-movement animation models.
- `client/board-geometry.ts`, `client/board-descriptions.ts`, and `client/card-presentation.ts`
  - Stateless SVG geometry, board typography, card artwork, and hover-card presentation.
- `client/board-grid-view.ts` and `client/board-preview-projection.ts`
  - Board-cell construction/event delegation and pure staged-action projections.
- `client/deck-builder-controller.ts` and `client/application-shell.ts`
  - Own deck-builder state and application login/menu/queue/Playground lifecycle respectively, communicating with the match renderer through callbacks.
- `client/troop-tray-controller.ts`, `client/match-connection.ts`, and `client/match-action-bar.ts`
  - Own troop tray/drag interaction, WebSocket lifecycle, and match action controls without duplicating authoritative match state.
- `client/board-animation-view.ts`
  - Reusable reduced-motion-aware SVG primitives for shields, stun, projectile trails, and mending playback.
- `client/hex-grid-state.ts`
  - Holds the mutable browser-session state shared by the match integration modules.
- `client/application-elements.ts` and `client/browser-runtime.ts`
  - Own required DOM lookup and browser-only asset/API/busy-cursor support used during composition.
- `client/board-unit-renderer.ts`, `client/board-combat-projection.ts`, and `client/board-inspection-controller.ts`
  - Own SVG unit/bash drawing, control/modifier projection, and reversible movement/deployment inspection respectively.
- `client/board-effects-renderer.ts` and `client/board-resolution-effects.ts`
  - Own projectile/shield/stun/mending presentation and damage/bash/bomb resolution presentation respectively.
- `client/match-board-actions.ts`
  - Owns board action selection, staging, confirmation, target/path projection, and match-aware hover details.
- `client/match-board-renderer.ts`
  - Reconciles authoritative revisions, derives replay/resolution presentation state, and coordinates board paint order across unit and effect renderers.
- `client/match-session-controller.ts`
  - Owns match entry/resume, local-player projection, deck choice, per-match visual-state reset, and authoritative troop-view projection.

### Browser application

- `hex-grid.html`
  - Application markup, SVG definitions, and the current stylesheet.
- `hex-grid.ts`
  - Is the browser composition root: it instantiates the application shell, deck builder, connection, action bar, board grid, renderers, and interaction controllers; connects their callbacks; and starts the application.
  - Detailed lifecycle, projection, rendering, resolution, and board-action behavior live in the client modules above. All browser TypeScript source files remain below 500 lines.

## Authoritative state flow

Passive-description presentation is explicit: catalogue text wrapped in `~...~` is projected as purple magic-modifier text. The marker is decorative only, is removed by HTML and SVG renderers, and does not affect authoritative modifier resolution.

Pending-resolution snapshots identify their source by owner-scoped unit ID when it is still deployed. The client uses that authoritative identity for source highlighting; resolution legality and passive damage immunity remain engine responsibilities.

Input-bearing triggered actions reuse the ordinary visual projection pipeline. `resolve-move` and `resolve-pull` stage the moved troop and any prospective bash, with Pull recording its authoritative origin for opponent confirmation playback. Instant/death ranged and instant Magic choices preview from the pending resolution's snapshotted origin and damage, then switch to their existing one-shot authoritative resolution presentation on confirmation. Triggered Stun previews the target animation while staged and retains the normal effect-backed playback after confirmation.

Instant-damage animation is reconstructed client-side from two authoritative snapshots: the previous pending resolution supplies origin and damage, while the new revision event supplies the selected target. This presentation does not add a persistent engine effect or delay authoritative resolution.

### Selection

1. The player selects a troop or action.
2. The browser sends a WebSocket `select` message.
3. The server computes legal actions and target selection state.
4. The browser receives and renders the authoritative snapshot.

Some local state is retained for staged confirmations, but previews must not be rendered twice—once locally and once from the echo. Animation-bearing previews should have a single creation point.

Push and Pull actions distinguish troop targets with `targetUnitId` and bomb targets with `targetBomb`. The authoritative engine moves the selected object along the corresponding straight displacement line. Pull travels its full printed distance toward the source and may pass through the source hex to land behind it; only the final landing hex determines occupancy or bash. If another bomb occupies the destination, it retains one bomb record there and adds the moved bomb's damage. The Bomb action merges the same way: throwing onto a hex that already holds a bomb adds the new damage to the existing record instead of creating a second bomb. The client projects that merged record during staging and sends the same explicit target discriminator on confirmation.
Static keyword mechanics are declared in `TroopSeed.passives`. The shared passive registry generates compact card text and full hover rules, while the engine queries the same list instead of card IDs or individual boolean flags. The current keywords are First Strike, Obsidian, Titanium, and Steady.
First Strike (`first-strike`) deals its bash damage before the opponent can retaliate; a defeated enemy does not retaliate, while a surviving enemy deals its remaining combat power back. The authoritative `bashResolved` trigger carries the two damage amounts so clients can present the ordered strikes without predicting rules state.
Stun is an immediate troop-targeted action. The authoritative unit stores `stunnedTurns`, clears both shield and magic-modifier state when the stun lands, and decrements the counter only when the stunned player's turn ends; this makes `1🚫M` disable the next opponent turn and expire before that opponent's following turn. The stun effect remains in the snapshot long enough for clients to play its one-shot presentation.
Raven Prince uses the same stun resolution as an End trigger: its `End: 1🚫1` action opens an enemy-target selection when an enemy is in range, then records a normal authoritative stun effect unless the trigger is skipped.
Triggered actions only enter the pending-resolution queue when they have a legal target. Targetless choices complete their stack row automatically; queued choices expose `resolve-pass`, while the client selects the first non-pass resolution action so its targets render immediately. Sandbox restoration seeds the pending source selection and follows the resolution owner rather than the underlying normal-turn player. A Start-trigger resolution records that it must resume the current player's normal action phase; resolving or skipping it neither ends the turn nor updates `lastActingTroopId`. End, death, and action-produced trigger choices still finish the turn after their queue is resolved or skipped.

Defense animations follow that rule explicitly: local Defense/Self Defense waits for the target-selection echo before constructing its one-shot preview. On an authoritative revision, only the non-acting client constructs the confirmed shield playback, so the acting client does not see the preview repeated after confirmation. Confirmed shields are stored on their receiving `UnitState` rather than as coordinate-bound effects; they move with that troop and are consumed by a resolving physical attack over it or by that troop's true action. Triggered resolution actions such as optional End movement are not true actions and do not consume the shield. The same authoritative unit snapshot carries a separate `magicModifierBonus`; `combat.magicModifier` is projected alongside the physical combat modifier, and a resolving troop-targeted Magic attack consumes only that magic modifier.
Explicit Magic Defense actions use the normal staged/confirmed Defense dispatcher with its purple magic flag. Ordinary positive or negative magic-modifier changes are numeric state changes and do not play shield animation. Snapshot-difference animation is instead limited to newly added physical shields, allowing triggered grants such as Tortoise Emperor's adjacent End shelter to play normal shield frames without duplicating explicit Defense actions.
Magic Defense is modeled as a physical-Defense-shaped card action (`defense` with the `magic` qualifier) and a separate `selfMagicDefense` card capability. The authoritative engine applies the value to `magicModifierBonus` on a friendly target; only cards with `selfMagicDefense` receive the coordinate-free self action, and server selection validation preserves that distinction. Shared side-card projection includes both `selfDefense` and `selfMagicDefense` capabilities directly instead of relying on manually repeated passive text.

The catalogue’s event-triggered modifiers are stored separately from temporary shields and control modifiers. Permanent physical and magic bonuses accumulate on the troop, survive ordinary damage, and are removed by Stun. Obsidian and Titanium are passive keywords enforced at resolution: Obsidian ignores magic damage sources, while Titanium ignores physical attack and Gore damage. Steady is likewise keyword-driven and suppresses the opposing bash participant's modifier.

Deployment is an explicit trigger signal, and successful physical attacks carry the resolved target unit ID. This lets deployment modifiers and target-specific hit effects (such as Needle Peacock’s Stun) resolve without reselecting a coordinate after the attack.

Mending follows the same audience split while retaining a looping local flight: local staged state owns the repeating heart trajectory and records whether its one-time target sweep has played; an authoritative Mending revision constructs a one-shot flight and sweep only when the confirming player is remote.

Persistent bombs do not carry their launch origin in authoritative state. The browser caches the source coordinate when a bomb first appears, keyed by owner/source/target, solely to keep its repeating visual trace stable if the source troop later moves. The cache is discarded when that bomb leaves authoritative state and never affects rules or targeting.

Repeating Bomb, Fire Magic, ranged, and Cannon presentations also retain a browser-local start time under that stable owner/source/kind/target identity. Selection echoes and the confirming revision may rebuild SVG nodes, but they resume the existing cycle with a negative animation delay. Remote target-selection echoes do not construct action animations; the opponent starts the presentation only from the authoritative confirming revision. Cannon groups its authoritative per-hex effects into one source-to-endpoint projectile, and its straight repeating flight ends when those effects resolve. A Bomb trace remains active while its source troop is recorded as that owner's last-acting (inactive) troop and stops when a later troop action makes the bomber available again.

Delayed Attack and Magic effects snapshot their source coordinate as `origin`. Projectile reconstruction prefers the live source coordinate but falls back to that origin if the caster has left play, so the opposing client does not lose the pending trajectory or the eventual lethal resolution presentation.
Gore validates a straight aligned destination within range and snapshots every enemy on the charge line into delayed damage effects. Selection locally projects the source at the endpoint and repeats a direction-rotated, 1.8× `horns.png` head from origin to destination. Confirmation moves the authoritative source immediately and creates any occupied destination bash; only the opponent replays that confirmed movement, while both clients derive the continuing horns from the pending effects. After the opponent completes a true action, every recorded enemy still on its snapshotted hex receives modifier- and shield-aware physical Gore damage, the effects disappear, and the horns stop before slash/health playback. Each damaging path hit emits a `successfulAttack` event carrying Gore as its originating action kind, so hit-triggered passives stack once per damaged troop. Friendly troops may be crossed but a friendly destination remains invalid. Snapshot comparison retains movement-at-resolution support only for older persisted Gore states whose source is still at the recorded origin.
Attack card qualifiers are carried into the authoritative effect as metadata: `pierce` marks a physical ranged attack that deals its full value without subtracting the target's physical modifier, while still consuming a shield on the target. The client renders attack qualifiers immediately before the ranged emoji (`P🏹` for Pierce and `F🏹` for instant/fast; both may be combined).

Fire Magic ignition removes a bomb from authoritative `bombs` immediately and replaces it with pending area-damage effects. The browser uses the center explosion effect plus the latest Magic event to project the fixed lit-bomb icon until resolution. Preview timing is local; after confirmation the acting client keeps the lit result without replay, while only the opponent constructs the one-shot fire delivery and impact-timed icon switch. Both clients derive one headless repeating caster-to-origin trajectory from the same pending effects and latest Magic event; removing those effects removes the trace before explosion/damage presentation.

Bomb effects carry their explosion-center `origin`. When a resolving explosion reaches an inert bomb, the engine removes that bomb and creates a fresh seven-hex effect set with the reached bomb as its origin. The new effects are owned by the player whose completed action triggered the current resolution, so they survive the current pass and resolve after the following player's action. This produces one chain-reaction step per turn instead of resolving every connected bomb immediately. Instant fire magic detonates the bomb it touches in the same action. Fire magic with the pierce qualifier lights a bomb whose blast carries `pierce`: the client shows `damageP` beside the bomb icon, the blast ignores Obsidian magic immunity, and merges keep the pierce mark when either bomb has it. Direct pierce fire also ignores the target's magic modifier, and Mole Artificer is the first card with a piercing fire action.
Start-trigger choices are not response actions, so they do not resolve a lit bomb. The bomb remains pending through those choices and explodes after the active player completes a true action or passes their normal turn.

Bomb explosion presentation is derived from bomb effects removed between consecutive authoritative snapshots. All removed-effect coordinates create one simultaneous visual stage, independent of occupancy. Damage animations for troops found on those coordinates carry a matching delay, keeping the ordering deterministic: area explosion first, then slash and authoritative health handoff.

### Confirmation

1. The user chooses a legal target.
2. The browser stages `serverPendingAction` and displays the preview.
3. The user presses **Confirm action**.
4. The browser sends an `action` message.
5. The server applies the action through the engine and broadcasts the new revision.
6. The browser clears transient selection state and renders confirmed state.

### Revisions

`ServerMatchState.revision` distinguishes authoritative game progress from selection-only echoes. UI code uses revision changes to clear stale pending state and to decide when opponent-facing confirmed animations should play.

Damage resolution animation compares the previous and next authoritative snapshots. Consumed Attack/Magic effects identify impacted targets; old combat values drive the transient counter animation and the new snapshot supplies final health. At the end of a physical slash, the temporary modifier and health counters are removed so the normal authoritative actual/total health row remains. A removed bash with a matching new `bashResolved` trigger creates a transitional old split layered above the authoritative winner, allowing shield, slash, and loser-collapse stages to finish in order.

Lethal damage copies are owned by the impacted hex rather than the removed authoritative unit. Ordinary selection and hover rerenders preserve the retained card/skull stage until its own timer completes.

Bash disappearance alone is not a combat-resolution signal: a defender can remove a bash by fleeing. The browser compares authoritative trigger-event histories and constructs the transitional slash/slider only when the revision adds a `bashResolved` event whose hex, attacker, and defender match the removed bash. `bashRetreat` leaves no combat transition.

## Turns and resolution

A newly created bash is ineligible for combat until an End phase completes. It then resolves in the first subsequent `combat-resolve` phase, regardless of which participant owns that turn. This makes Start-trigger bashes wait through the current player's action and End phase, giving the following player an action in which either participant they control may flee. A bash created by an End-trigger choice becomes eligible when that same End phase finishes and resolves after the following player's action. Legacy persisted bashes without the lifecycle marker are treated as already eligible.

The main phases are documented in `README.md`:

1. `start`
2. `action`
3. `action-resolve`
4. `combat-resolve`
5. `end`

Effects, bashes, bombs, triggers, and optional choices can survive across phases. The dashboard and LIFO resolution stack preserve trigger provenance and ordering.

## Persistence

Local state lives under `data/`:

- `runtime.json` — active matches, queues, and waiting players.
- `users.json` — local users/decks.
- `sandboxes/` — saved Playground checkpoints.
- `match-logs/` — retained diagnostic histories; only the ten newest log files are kept.

Live-match runtime loading and saving is temporarily disabled at server construction, so restarting the process starts with no active matches or matchmaking queue. Existing runtime files remain untouched for reversibility. User decks, saved Playground checkpoints, and the ten retained diagnostic match logs continue to persist independently. The dormant runtime implementation bounds per-match diagnostics to 100 compact entries without repeated histories and retains its atomic primary/backup write path for when recovery is re-enabled.

## Testing

- Engine coverage is split by domain: `tests/engine-catalogue-triggers.test.mjs`, `tests/engine-deployment-control.test.mjs`, `tests/engine-combat.test.mjs`, `tests/engine-actions.test.mjs`, and `tests/engine-effects.test.mjs`. Each file creates an isolated card map through `tests/helpers/engine-fixture.mjs`, so fixture mutations cannot leak between domains.
- `tests/match-store.test.mjs` covers authoritative match transitions.
- `tests/server.integration.test.mjs` covers HTTP/WebSocket integration.
- `tests/deck-state.test.mjs` covers deck operations.

Visual behavior additionally requires live-browser verification. Unit tests cannot establish SVG paint order, clipping, pointer behavior, or animation continuity.
