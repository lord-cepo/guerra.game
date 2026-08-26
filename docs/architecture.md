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

### Browser application

- `hex-grid.html`
  - Application markup, SVG definitions, and the current stylesheet.
- `hex-grid.ts`
  - Screen navigation and login/deck UI.
  - The deck builder's client-only search parses ordinary name terms and `t:` action-kind filters against normalized active and triggered card actions, then renders only matching available cards without changing deck legality or persistence.
  - WebSocket connection and match rendering.
  - SVG board construction.
  - Local action staging and previews.
  - Troop/card rendering, hover information, and animations.

`hex-grid.ts` is currently a large integration module. New behavior should be extracted into focused helpers. If it continues growing, the natural future split is:

```text
client/board-renderer.ts
client/action-previews.ts
client/board-animations.ts
client/match-controller.ts
client/screens.ts
```

Do not perform this refactor incidentally while implementing an unrelated visual adjustment.

## Authoritative state flow

### Selection

1. The player selects a troop or action.
2. The browser sends a WebSocket `select` message.
3. The server computes legal actions and target selection state.
4. The browser receives and renders the authoritative snapshot.

Some local state is retained for staged confirmations, but previews must not be rendered twice—once locally and once from the echo. Animation-bearing previews should have a single creation point.

Push and Pull actions distinguish troop targets with `targetUnitId` and bomb targets with `targetBomb`. The authoritative engine moves the selected object along the corresponding straight displacement line; if another bomb occupies the destination, it retains one bomb record there and adds the moved bomb's damage. The client projects that merged record during staging and sends the same explicit target discriminator on confirmation.
First Strike is a static troop keyword (`TroopSeed.firstStrike`). During bash resolution, that participant deals its combat power minus the enemy modifier first; a defeated enemy does not retaliate, while a surviving enemy deals its remaining combat power back. The authoritative `bashResolved` trigger carries the two damage amounts so clients can present the ordered strikes without predicting rules state.
Stun is an immediate troop-targeted action. The authoritative unit stores `stunnedTurns`, clears both shield and magic-modifier state when the stun lands, and decrements the counter only when the stunned player's turn ends; this makes `1🚫M` disable the next opponent turn and expire before that opponent's following turn. The stun effect remains in the snapshot long enough for clients to play its one-shot presentation.
Raven Prince uses the same stun resolution as an End trigger: its `End: 1🚫1` action opens a mandatory enemy-target selection when an enemy is in range, then records a normal authoritative stun effect.

Defense animations follow that rule explicitly: local Defense/Self Defense waits for the target-selection echo before constructing its one-shot preview. On an authoritative revision, only the non-acting client constructs the confirmed shield playback, so the acting client does not see the preview repeated after confirmation. Confirmed shields are stored on their receiving `UnitState` rather than as coordinate-bound effects; they move with that troop and are consumed by a resolving physical attack over it or by that troop's true action. Triggered resolution actions such as optional End movement are not true actions and do not consume the shield. The same authoritative unit snapshot carries a separate `magicModifierBonus`; `combat.magicModifier` is projected alongside the physical combat modifier, and a resolving troop-targeted Magic attack consumes only that magic modifier.
Magic modifier gains use the same client shield-frame sequence as physical Defense, applying a purple image filter and targeting the receiving troop's current hex. The same snapshot-difference path is used during turn replay, without a source flight.
Magic Defense is modeled as a physical-Defense-shaped card action (`defense` with the `magic` qualifier) and a separate `selfMagicDefense` card capability. The authoritative engine applies the value to `magicModifierBonus` on a friendly target; only cards with `selfMagicDefense` receive the self action.

The catalogue’s event-triggered modifiers are stored separately from temporary shields and control modifiers. Permanent physical and magic bonuses accumulate on the troop, survive ordinary damage, and are removed by Stun. Obsidian and Titanium are card flags enforced at resolution: Obsidian ignores magic damage sources, while Titanium ignores physical attack and Gore damage.

Deployment is an explicit trigger signal, and successful physical attacks carry the resolved target unit ID. This lets deployment modifiers and target-specific hit effects (such as Needle Peacock’s Stun) resolve without reselecting a coordinate after the attack.

Mending follows the same audience split while retaining a looping local flight: local staged state owns the repeating heart trajectory and records whether its one-time target sweep has played; an authoritative Mending revision constructs a one-shot flight and sweep only when the confirming player is remote.

Persistent bombs do not carry their launch origin in authoritative state. The browser caches the source coordinate when a bomb first appears, keyed by owner/source/target, solely to keep its repeating visual trace stable if the source troop later moves. The cache is discarded when that bomb leaves authoritative state and never affects rules or targeting.

Repeating Bomb, Fire Magic, ranged, and Cannon presentations also retain a browser-local start time under that stable owner/source/kind/target identity. Selection echoes and the confirming revision may rebuild SVG nodes, but they resume the existing cycle with a negative animation delay. Remote target-selection echoes do not construct action animations; the opponent starts the presentation only from the authoritative confirming revision. Cannon groups its authoritative per-hex effects into one source-to-endpoint projectile, and its straight repeating flight ends when those effects resolve. A Bomb trace remains active while its source troop is recorded as that owner's last-acting (inactive) troop and stops when a later troop action makes the bomber available again.
Gore validates a clear straight movement destination, moves its source troop to the final hex immediately, and rejects friendly occupants. An enemy occupant starts a normal bash and receives a delayed targeted physical `gore` effect; an empty destination produces no effect. The effect resolves during the opponent's response, uses physical modifiers and shields, and is skipped if the enemy leaves the target hex. Remote confirmation animates the troop's movement from the recorded event origin; the local staged preview uses the Cannon-style straight `horns.png` presentation.
Attack card qualifiers are carried into the authoritative effect as metadata: `pierce` marks a physical ranged attack that deals its full value without subtracting the target's physical modifier, while still consuming a shield on the target. The client renders attack qualifiers immediately before the ranged emoji (`P🏹` for Pierce and `F🏹` for instant/fast; both may be combined).

Fire Magic ignition removes a bomb from authoritative `bombs` immediately and replaces it with pending area-damage effects. The browser uses the center explosion effect plus the latest Magic event to project the fixed lit-bomb icon until resolution. Preview timing is local; after confirmation the acting client keeps the lit result without replay, while only the opponent constructs the one-shot fire delivery and impact-timed icon switch. Both clients derive one headless repeating caster-to-origin trajectory from the same pending effects and latest Magic event; removing those effects removes the trace before explosion/damage presentation.

Bomb effects carry their explosion-center `origin`. When a resolving explosion reaches an inert bomb, the engine removes that bomb and creates a fresh seven-hex effect set with the reached bomb as its origin. The new effects are owned by the player whose completed action triggered the current resolution, so they survive the current pass and resolve after the following player's action. This produces one chain-reaction step per turn instead of resolving every connected bomb immediately.

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
- `match-logs/` — retained diagnostic histories.

`runtime.json` may become large. Runtime saves are serialized per server instance, written completely to a unique process/save-specific temporary file, and atomically renamed into place. Unique temporary files are required because two server processes can otherwise rename the same shared temp file while it is still being written, publishing NUL-filled or partial JSON. Before replacement, a valid current file is renamed to `runtime.backup.json`; startup falls back to that last-known-good backup when the primary file is missing or malformed. If neither file is valid, startup fails without deleting or replacing either file. Generated runtime data should remain untracked.

## Testing

- `tests/engine.test.mjs` covers rules and action behavior.
- `tests/match-store.test.mjs` covers authoritative match transitions.
- `tests/server.integration.test.mjs` covers HTTP/WebSocket integration.
- `tests/deck-state.test.mjs` covers deck operations.

Visual behavior additionally requires live-browser verification. Unit tests cannot establish SVG paint order, clipping, pointer behavior, or animation continuity.
