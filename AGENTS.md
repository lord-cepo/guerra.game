# Guerra development instructions

## Scope

These instructions apply to the entire repository.

## Project shape

- `game/` contains deterministic game rules and board geometry. Keep it independent of the DOM and server transport.
- `server/` and `server.mjs` own matchmaking, authoritative match state, persistence, HTTP routes, and WebSocket messages.
- `client/` contains shared client projections, protocol types, deck state, and card-description helpers.
- `hex-grid.ts` is the browser controller and SVG renderer. `hex-grid.html` contains the page structure and current CSS.
- `assets/` contains the hand-drawn board, card, frame, icon, and background artwork.
- `dist/`, `node_modules/`, and `data/` are generated or local runtime state and must not be committed unless explicitly requested.

Read `docs/architecture.md` and `docs/board-rendering.md` before changing board rendering, previews, animations, or interaction state.

## Documentation workflow

- Whenever the user asks to add a new feature, update the relevant Markdown documentation as part of the implementation so future tasks can understand it without relying on chat history.
- Record the feature's current behavior and implementation status in `docs/current-state.md`.
- Update `docs/architecture.md` when the feature changes responsibilities, state flow, protocols, or major components.
- Update `docs/board-rendering.md` when the feature changes board geometry, rendering, interaction, previews, or animations.
- Keep documentation changes concise and limited to behavior that was actually implemented.

## Development commands

```bash
npm run check
npm run build
npm test
npm run start:playground
```

- Use `npm run check` for a fast TypeScript validation.
- Run `npm run build` after TypeScript changes because the server serves compiled files from `dist/`.
- Run focused tests or `npm test` in proportion to the change. Report any unrelated pre-existing failures separately.
- Start development servers with Playground enabled: `node server.mjs --playground` or `npm run start:playground`.

## Server lifecycle

- Keep the Playground server running in the background after changes when practical.
- CSS/HTML-only changes generally do not require a restart; TypeScript or server changes do.
- Stop the existing process before starting another one. A second server on port 3000 produces misleading connection behavior.
- `data/runtime.json` can be large. After stopping the server, validate that its write completed before restarting:

```bash
node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('data/runtime.json','utf8')); console.log('runtime valid')"
```

- Do not delete or replace runtime data merely to make the server start. Preserve user data and diagnose first.

## Implementation rules

- Treat the server as authoritative. Local previews may project state, but confirmed actions must come from server state.
- Avoid rendering the same preview both optimistically and again on the WebSocket selection echo; this restarts CSS/Web Animations and causes visible glitches.
- Keep complete troop visuals rigid during motion. Artwork, info frame, health, modifier, and description should share one moving SVG group unless a deliberate layer must remain fixed.
- Preserve existing user assets and filename conventions. Card artwork normally maps automatically from card ID to `assets/cards/<card-id>.png`; document intentional aliases.
- Do not add SVG border highlights. The PNG hex artwork owns the visible border.
- Preserve reduced-motion fallbacks for new animations.
- Prefer small named helpers over adding more logic directly to the main render loop.

## Board coordinates

The board has one shared horizontal orientation for both players and is not globally rotated. SVG directions match browser directions: negative X is left, positive X is right, negative Y is up, and positive Y is down. See `docs/board-rendering.md`.

## Visual style

- Preserve the parchment, pencil-drawn, low-saturation aesthetic.
- Use the Kalam font and existing outlined/shadowed typography patterns.
- Prefer soft opacity, fading, clipping, and hand-drawn traces over bright digital glows.
- Red / Player 1 belongs on the left in split bash presentation; Blue / Player 2 belongs on the right.
- Inactive troop artwork uses the warm parchment-grayscale filter and must not animate on hover.

## Verification

- For board/UI changes, use the live browser when available and verify the actual interaction, not only static DOM output.
- Check both active-player preview and opponent confirmed-state views when an animation has two audiences.
- Check hover entry, hover exit, direct side-to-side movement, confirmation, cancellation, and re-render behavior.
- Check the browser console for runtime errors.
- Run `git diff --check` before handing off.

## Working tree safety

- The working tree may contain extensive user changes and untracked artwork. Do not discard, reset, overwrite, or reformat unrelated work.
- Use `apply_patch` for edits and keep changes narrowly scoped.
- Do not create commits unless the user asks.
