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

### Confirmation

1. The user chooses a legal target.
2. The browser stages `serverPendingAction` and displays the preview.
3. The user presses **Confirm action**.
4. The browser sends an `action` message.
5. The server applies the action through the engine and broadcasts the new revision.
6. The browser clears transient selection state and renders confirmed state.

### Revisions

`ServerMatchState.revision` distinguishes authoritative game progress from selection-only echoes. UI code uses revision changes to clear stale pending state and to decide when opponent-facing confirmed animations should play.

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

`runtime.json` may become large. Server shutdown can still be writing it briefly, so validate it before an immediate restart. Generated runtime data should remain untracked.

## Testing

- `tests/engine.test.mjs` covers rules and action behavior.
- `tests/match-store.test.mjs` covers authoritative match transitions.
- `tests/server.integration.test.mjs` covers HTTP/WebSocket integration.
- `tests/deck-state.test.mjs` covers deck operations.

Visual behavior additionally requires live-browser verification. Unit tests cannot establish SVG paint order, clipping, pointer behavior, or animation continuity.

