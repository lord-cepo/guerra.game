# Current development state

This is a concise handoff, not a changelog. Update it when a feature group or architectural assumption changes.

## Product state

- Browser turn-based strategy game with 8- and 10-card decks.
- Authoritative Node/WebSocket match server.
- Developer Playground can control both sides, freely place troops, save/load checkpoints, undo, and pass turns.
- Board uses hand-drawn parchment artwork, control-colored PNG hexes, card pictures, and turn-colored frame jewels.

## Board presentation

- Player 1 / Red is conceptually left; Player 2 / Blue is right.
- Front-line control uses the dark version of the controlling player's color.
- SVG interaction borders are disabled; PNG assets own visible hex borders.
- Available targets lift 3px, scale to `0.95`, and use a 12% white fill.
- Free hover uses an 8% black wash.
- Inactive troop artwork uses a warm parchment-grayscale treatment.

## Implemented previews and animations

- Deployment fall/materialization, including opponent confirmation view.
- Move/Fly dissolve and translated source/destination transition.
- Straight-line ease-out Push animation.
- Split bash pictures with reversible left/right inspection.
- Unlit bomb selection marker, parabolic throw, drawn/erased pencil trace, and stable confirmed endpoint.

See `docs/board-rendering.md` for behavior and implementation constraints.

## Assets and conventions

- Card artwork is discovered from `assets/cards/<card-id>.png`.
- Known spelling aliases should stay explicit and minimal.
- `frame_bg_sat.png` is the current board-frame base.
- `frame_jewel_red.png` and `frame_jewel_blue.png` indicate active player.
- `card_frame.png` and `button.png` provide hand-drawn UI frames.
- `bomb-unlight.png` is used for unlit bombs; `bomb.png` is reserved for ignition.

## Known technical pressure points

- `hex-grid.ts` and `hex-grid.html` are large and mix several responsibilities.
- Full board re-rendering can restart transient animations.
- SVG clipping, paint order, CSS transforms, and Web Animations still interact in non-obvious ways.
- `data/runtime.json` can become very large, making shutdown/restart persistence slow.
- Visual behavior lacks deterministic automated browser scenarios.

## Recommended next engineering steps

1. Add deterministic Playground fixtures for deploy, move, push, bash, and bomb states.
2. Add screenshot/interaction regression checks for those fixtures.
3. Make runtime persistence atomic and serialized, then add a regression test for concurrent saves.
4. Extract preview calculations and animations from `hex-grid.ts` into focused client modules.
5. Add a small `npm run verify` workflow for check, build, tests, and `git diff --check`.

## Handoff protocol

At the end of a substantial task:

1. Run appropriate checks.
2. Visually verify interactive changes.
3. Update this file only if current behavior, architecture, or next priorities materially changed.
4. Record unrelated failures separately rather than rewriting history here.
