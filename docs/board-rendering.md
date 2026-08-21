# Board rendering and interaction architecture

## Coordinate systems

The game uses axial coordinate strings such as `"-1,2"`. `game/board.ts` owns topology; `hex-grid.ts` maps axial coordinates to SVG pixels.

Important constants currently live near the SVG construction code:

- `size = 42`
- `hexGap = 1.5`
- `horizontalScale = 1.4`
- board center `(400, 310)`

The SVG is horizontally stretched. Geometry intended to follow a hex edge must account for `horizontalScale` in X.

## Shared board orientation

The board uses one horizontal orientation for both players. It has no global player-dependent rotation, and troop artwork and text require no counter-rotation. SVG directions therefore match browser directions:

| Intended browser direction | SVG delta |
|---|---:|
| left | `-x` |
| right | `+x` |
| up | `-y` |
| down | `+y` |

When an element has another local transform, verify composition in the browser rather than relying only on this table.

## Hex construction

Each `.cell` SVG group contains persistent board geometry:

1. Cell clip path.
2. `.board-hex-artwork` PNG.
3. Invisible `.hex` polygon used for geometry and pointer interaction.
4. Coordinate label, normally hidden.

Server-rendered children are rebuilt from snapshots. A final `.hex-border-overlay` provides an overlay surface for fills while PNG artwork supplies the visible hand-drawn edge.

Do not restore SVG strokes. All interaction states should keep SVG borders disabled.

## Control-colored artwork

`controlledBoardHexArtwork` maps region control to:

- Player 1: `hex_dark_red.png` or `hex_light_red.png`
- Player 2: `hex_dark_blue.png` or `hex_light_blue.png`
- Uncontrolled front: `hex_grey.png`

Starting regions and the front line use the dark version of the controlling player's color. Intermediate and side regions use the light version.

## Paint order

SVG paint order follows DOM order; normal CSS `z-index` is not sufficient for these groups. The intended conceptual stack is:

```text
top
  action/hover overlays and transient trajectories
  hand-drawn hex border artwork
  troop text, health, and info frame
  troop card picture
  region artwork/background
bottom
```

There are deliberate exceptions:

- A troop's animated visual is grouped rigidly so its artwork and information move together.
- The transparent ornamental hex PNG is appended after the troop visual so its painted edge remains above the card picture.
- Available action cells are appended later in the SVG to gain paint-order priority.
- Bomb trajectories are appended after action cells so the bomb and pencil trace remain visible during flight.

When changing order, inspect both empty and occupied targets, bashes, and action overlays.

## Troop visual groups

`appendServerBoardUnit` creates `.board-unit-visual`, containing:

- `.board-troop` card artwork/fallback icon;
- the faded player-colored info frame;
- optional action-description highlight;
- `.board-troop-description` health and ability text.

Animations should normally target `.board-unit-visual`, not only `.board-card-picture`, so text and artwork do not separate.

Card pictures use a cached twenty-band SVG mask. The mask fades relative to the actual hex boundary rather than the rectangular image boundary.

Inactive/last-acting troop pictures use a warm grayscale/sepia parchment filter. They do not run the occupied-card hover animation.

## Interaction language

- Available action hexes translate upward slightly, scale to `0.95`, and receive a 12% white overlay.
- Free-hex hover uses an 8% black wash.
- Occupied-card hover uses a small Y-axis perspective oscillation.
- The central hex is non-interactive.
- Selected troop cards do not receive a colored frame highlight.
- SVG outlines, dashed borders, focus borders, and hover borders are globally suppressed.

## Preview architecture

Transient browser state includes:

- selected troop and action;
- staged action awaiting confirmation;
- push target choices;
- hover/reveal coordinate;
- projected unit, bash, damage, and bomb state.

The key rule is to construct animation-bearing DOM once. If an optimistic render will immediately be followed by the selection echo, wait for the echo instead. Replacing animated nodes restarts or truncates animations.

## Current animations

### Deploy

- Active player sees the troop fall/materialize in the staged destination.
- Opponent sees the animation after authoritative confirmation.
- One-shot keys prevent ordinary re-renders from replaying confirmed deployment.

### Move and Fly

- A source visual dissolves while moving toward browser `+Y`.
- A destination visual materializes from browser `+Y`.
- Both are rigid `.board-unit-visual` groups.

### Push

- The projected destination group begins at the source-center offset.
- It follows the exact straight line with a fast-starting ease-out curve.
- It does not use the Move dissolve effect.

### Bash

- Player 1 / Red is clipped to the left half; Player 2 / Blue to the right.
- Full-size pictures are not resized.
- Health and signed modifier are positioned inward.
- Hovering a side expands that picture, centers its health/modifier, fades in its normal bottom information, and dissolves the opponent.
- Leaving reverses the transition. Crossing sides returns through the neutral split state before expanding the other side.
- Legacy hover rendering must not rebuild a bash cell; doing so destroys the transition nodes.

### Bomb

- Selecting Bomb places `bomb-unlight.png` on the browser-left edge of the source hex.
- Target selection animates the same unlit bomb along a sampled quadratic parabola to the browser-right edge of the target.
- The bomb remains upright; do not use trajectory tangent rotation.
- A 40%-opacity graphite trace draws with the flight, waits one second, then erases source-to-target.
- Confirmation places the bomb at the exact flight endpoint, avoiding a jump.
- `bomb.png` is reserved for a future lit/ignited state.

## Visual verification checklist

For each animation, check:

1. First staging render.
2. WebSocket selection echo.
3. Confirmation revision.
4. Active-player and opponent views.
5. Pointer entry and exit during/after animation.
6. Cancellation or choosing another target.
7. Reduced-motion behavior.
8. Paint order against deck panels, hex PNG borders, and neighboring cells.
9. Browser console errors.
