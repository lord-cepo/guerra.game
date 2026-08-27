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
- description fragments wrapped in `~...~` are rendered as purple magic modifiers with the markers removed;
- a living troop that owns the current pending resolution receives a clipped yellow wash at `0.4` alpha inside its rigid unit visual;
- inactive/last-acting styling may hide its ordinary overlay, but never the availability wash of a currently legal target; occupied endpoints therefore remain visible at the edge of an action's range;
- the faded player-colored info frame;
- optional action-description highlight;
- `.board-troop-description` health and ability text.

Every occupied board hex renders actual/total health and the signed combat modifier in its upper stat area, plus exactly three ability/effect rows in the lower information area. A troop with both physical and magic modifiers displays them consecutively as `+M+N`; a lone magic modifier displays as `+N`. Missing information rows remain empty to keep spacing stable. If more information exists, the third information row keeps its normal text and ends with `...`; full details remain available outside the compact hex summary.

Compact card and hex summaries show `Move 0` only for immobile non-Fly troops. Fly already communicates the alternate movement capability, and temples are inherently immobile, so neither repeats `Move 0`.

All troops use the full `N ♥ M` form, where `N` is current health and `M` is total/base health, even when both values match. Health values and the heart use the same near-black 1.8px stroke/paint order as modifier values. The signed combat modifier remains directly below health and moves with the troop's rigid visual group.

This full form is board-specific. Side-tray and hover cards use the compact `♥ M` form for an unwounded troop and expand to `N ♥ M` only after it has taken damage.

Normal troop health derives from authoritative `ServerUnitState.currentHealth`. Damage and bash-resolution counters are removed from the DOM at completion rather than merely faded, because a completed Web Animation with forward fill can otherwise keep stale health UI above the authoritative row.

Animations should normally target `.board-unit-visual`, not only `.board-card-picture`, so text and artwork do not separate.

Card pictures use a cached twenty-band SVG mask. The mask fades relative to the actual hex boundary rather than the rectangular image boundary.

Inactive/last-acting troop pictures use a warm grayscale/sepia parchment filter plus a neutral grey wash at 50% alpha over the troop artwork. The colored info frame and text remain above the wash, and inactive troops do not run the occupied-card hover animation.

## Interaction language

- Available target hexes continuously ease over 1 second between their resting position and a `0.95` scale shifted 3px toward browser `+Y`; cells stay mounted so entry and exit both interpolate. They also receive a 24%-opacity white wash. Once a target is staged, its hex returns to the neutral geometry while the action animation carries the preview.
- Last-action, movement-path, push-source/destination, cannon-line, and confirmed-effect hex highlighting is hidden.
- Hex wash priority is deliberately limited to white for available targets and black for the hex directly under the pointer. Pending or confirmed Bomb, Magic, ranged, Cannon, and other action targets do not retain owner-colored fills.
- Occupied-card hover uses a small Y-axis perspective oscillation.
- The central hex is non-interactive.
- Selected troop cards do not receive a colored frame highlight.
- SVG outlines, dashed borders, focus borders, and hover borders are globally suppressed.
- Playground new/load/save/undo requests apply a global `progress` cursor. A reference count keeps it active until all overlapping requests finish, including error paths.
- Double-clicking a board troop does not open the full troop inspector; that entry point is temporarily disabled.
- Reduced-motion mode applies target transforms immediately instead of interpolating them.
- Visible troop-action buttons show and accept numeric keyboard shortcuts. `1` is reserved for Move (including an optional End Move); the remaining actions use `2` onward in displayed button order. Shortcuts are ignored while typing or when Alt/Ctrl/Command is held.
- `ArrowLeft` replays the latest completed authoritative turn transition observed by the client. Replay uses cached before/after snapshots, never sends an action or rewinds authoritative state, works for either player's action, and restarts the relevant one-shot or repeating presentation from its beginning without clearing the current selection. If that turn consumed earlier pending ranged, Fire Magic, or Cannon effects, replay reconstructs every consumed source-to-target projectile from the pre-turn snapshot and delays their slash/health resolution until those flights finish.

## Preview architecture

Transient browser state includes:

- selected troop and action;
- staged action awaiting confirmation;
- push target choices;
- hover/reveal coordinate;
- projected unit, bash, bomb, and projectile state.

Generic numeric damage previews are not rendered on the board or in hover details. Bash keeps its health/modifier presentation because those values are part of the split bash animation. Bomb damage remains beside the persistent bomb icon as part of the bomb presentation.

The key rule is to construct animation-bearing DOM once. If an optimistic render will immediately be followed by the selection echo, wait for the echo instead. Replacing animated nodes restarts or truncates animations.

Replay inspection starts with a left click and is suspended while a local troop selection is active or awaiting its server echo. Selecting a troop redirects any open replay toward the authoritative endpoint and prevents further replay entry until the selection is cleared, so action targeting (especially Bash) cannot visually move an inactive enemy away from its real hex. Hover alone only updates the ordinary troop/hex details.

Bash inspection has priority over action rewind. If a staged or confirmed bash occupies a hex, neither participant can rewind from that hex; pointer movement continues to drive the established left/right split-bash focus animation and matching hover details.

## Current animations

### Deploy

- Active player sees the troop fall/materialize in the staged destination.
- Opponent sees the animation after authoritative confirmation.
- One-shot keys and a retained start time prevent ordinary re-renders from replaying confirmed deployment. A selection echo that rebuilds the staged SVG resumes the same 1.4-second phase instead of truncating the preview at its resting frame.
- Confirmation preserves the staged result for the acting player without replay. Both players' currently inactive troops resolve their own inspection independently. Left-clicking an inactive deployed troop runs the deployment slider toward `0`; pointer exit runs it toward `1`. Changing direction samples the current position without snapping, then starts a fresh fast-start/slow-finish leg toward the new endpoint rather than literally reversing the original easing curve.

### Move and Fly

- A source visual dissolves while moving toward browser `+Y`.
- A destination visual materializes from browser `+Y`.
- Both are rigid `.board-unit-visual` groups.
- Local staging plays once and confirmation does not replay it for the acting player. The opponent does not animate a target-selection echo; the one-shot transition begins on authoritative confirmation.
- Every currently inactive troop—local and opposing—resolves inspection from its own most recent action rather than the match's globally latest event. If that action was Move/Fly, its origin/destination dissolve is controlled by one slider: `0` shows the origin and `1` shows the authoritative destination. A left click runs toward `0`, pointer exit runs toward `1`, and another click can change direction from the current position with a fresh fast-start/slow-finish leg.

### Push

- The projected destination group begins at the source-center offset.
- It follows the exact straight line with a fast-starting ease-out curve.
- It does not use the Move dissolve effect.
- Confirmation follows the same audience split as Move/Fly. Left-clicking the inactive pushing troop controls the pushed troop on one straight-line slider: `0` is its pre-push hex and `1` is its authoritative destination. The click runs toward `0`, pointer exit runs toward `1`, and changing direction starts immediately from the current position with the same fast-start/slow-finish easing in either direction.
- Bombs are legal Push targets and use the same straight-line ease-out preview, opponent-confirmed playback, and `ArrowLeft` turn replay. Bomb Push has no hover rewind. If the destination already contains a bomb, the moving bomb merges into it and the projected/final damage label is the sum of both bombs.

### Pull

- Pull uses the same target selection, straight-line ease-out displacement, opponent-confirmed playback, and reversible click replay as Push, but its landing line runs from the selected object toward the acting troop.
- Pull can target troops or bombs and travels its full printed distance toward the acting troop, continuing through the acting troop's hex when necessary. Intermediate occupants do not shorten the displacement; the final hex owns the normal friendly-occupant rejection or enemy bash flow.
- After selecting a target for an ordinary card-action Pull, the preview projects that object at its destination and softly fills every displacement hex through the endpoint. Triggered `resolve-pull` retains its compact endpoint-only preview.

### Stun

- Stun uses the compact `N🚫M` action form: `N` is the number of turns and `M` is target range. On confirmation, the target hex receives one full linear rotation of `assets/stun.png` at 1.5× the standard icon size, with a gradual fade-in and fade-out; the image does not repeat. Reduced-motion mode shows a static softened image.
- The authoritative target troop becomes inactive immediately, so it cannot be selected or act during its current upcoming turn. Its stun counter expires at that turn's end, making it available again at the start of its next turn.
- Raven Prince's End stun uses the same target selection and `assets/stun.png` rotation, offering enemy troops within one hex.
- Left-clicking a currently stunned troop replays the same enlarged, gradual-fade stun animation over that troop's hex.

### Bash

- Player 2 / Blue is clipped to the left half; Player 1 / Red to the right, matching the fixed screen trays now that the board is not rotated.
- A bash created by movement keeps the defender static in its normal half. Only the attacker's clipped half travels/materializes into the target, avoiding a second defender entrance.
- Retargeting a movement preview starts its dissolve at the previous preview coordinate rather than the authoritative source. If that previous preview was a bash, only the attacker's clipped half dissolves there.
- Deselecting uses the same visible preview as its return origin: the preview dissolves in place while the troop materializes simultaneously in its authoritative hex. A bash preview again dissolves only the attacker's half.
- The same clipped-half entrance is used for a locally staged move and for the first authoritative render after a confirmed Move or Fly creates a bash.
- Full-size pictures are not resized.
- Health and signed modifier are positioned inward.
- Hovering a side expands that picture, centers its health/modifier, fades in its normal bottom information, and dissolves the opponent.
- A Boar Warlord in a bash shows its ordinary permanent physical and magic modifiers in the split-bash stat rows; it gains +1 of each every time it enters a bash.
- The bottom-left hover card follows the same left/right side under the pointer, including direct crossings through the neutral split state.
- Leaving reverses the transition. Crossing sides returns through the neutral split state before expanding the other side.
- Legacy hover rendering must not rebuild a bash cell; doing so destroys the transition nodes.
- The resolution presentation is gated by a newly added authoritative `bashResolved` trigger matching the bash participants and hex. A removed bash with `bashRetreat` (the defender fled) does not play slash or slider animation.
- A resolved combat preserves the old split long enough to present events in order: an opponent-visible confirmed shield sequence when applicable, then the 1.5-second slash/health countdown using each side's compact `♥ actual` bash label, then a 420 ms slider collapse that clips out the defeated half and expands the winner. The transitional winner overlay then disappears, revealing the authoritative single-troop rendering with its normal `actual ♥ starting` health row. A tie collapses both halves.
- A First Strike bash uses the authoritative resolution details to slash the enemy half first. If that troop survives, its health settles at the post-first-strike value and a second 1.5-second slash hits the First Strike half; if it dies, no second slash is shown. The existing shield and slider timing remains ahead of and after the ordered strikes.

### Bomb

- A staged Bomb target uses the shared projectile loop as a single 36px upright bomb, regardless of damage. Its eight `trail.png` segments follow the same curved trajectory and no damage number is shown during preview.
- Every loop contains a short source materialization, source-to-target travel, impact dissolve, and a one-second empty buffer before restarting.
- On confirmation, both players see the bomb head launch once. The persistent target bomb and its authoritative damage value remain hidden during that first travel and appear only when the launched head reaches the target, making the animation visibly deliver the fixed entity; the number sits 1px left of the icon.
- After confirmation, the segmented trace repeats while the throwing troop remains its owner's last-acting inactive troop. It therefore survives the opponent's response and the beginning of the bomber owner's next turn, then stops when another troop action makes the bomber active again; the fixed authoritative bomb remains. The launch source is cached while the trace is active so troop movement cannot relocate it. Bomb presentation has no hover rewind.
- The bomb keeps the same 36px size in flight and after confirmation and remains upright rather than following the curve tangent.
- Bombs merge by summing damage whenever a second bomb lands on an occupied bomb hex: a Bomb action thrown onto an existing bomb adds its damage to it, and Pull merges like Push when the pulled bomb lands on one.
- The bomb damage label reads `N` for a normal bomb and `NP` when its blast was created by pierce fire. Instant fire magic detonates the targeted bomb immediately; pierce-lit blasts ignore Obsidian magic immunity, and merging keeps the pierce mark if either bomb has it. Direct pierce fire (Mole Artificer's `1P🔥2`) ignores the target's magic modifier as well.
- Fire Magic targeting an inert bomb redirects every fire lane from the target hex center to the fixed bomb icon center and replays its normal volley during the active player's staged preview. On the first impact, `bomb-unlight.png` and `bomb-light.png` crossfade over 350 ms, then the lit icon remains while the preview stays staged.
- Confirming ignition removes the inert bomb from authoritative `bombs` and creates pending area-damage effects. The renderer projects `bomb-light.png` from those effects so the lit entity remains visible: the acting player sees it already lit after the preview, while the opponent receives one fire flight to the bomb itself and sees the 350 ms ignition crossfade at first impact.
- The opponent receives the confirmed ignition fire projectile once. After confirmation, both players retain one repeating pencil trajectory from the caster to the lit bomb with no repeated projectile head. It uses the staged Fire Magic cycle identity where possible and remains until the authoritative Bomb effects resolve and the explosion begins.
- When pending Bomb effects resolve, the renderer groups them by their explosion `origin` and displays one large 120px `explosion-purple.png` horizontally centered on each origin hex and shifted 20px upward for 900 ms. The origin and all six adjacent hexes receive a purple wash at 25% alpha above board occupants so occupied tiles remain visibly involved. The image and all seven washes share the same bottom-to-top reveal, hold, and fade timeline; neighboring tiles receive the wash but do not duplicate the explosion image. For opponent-facing playback and turn replay, a confirmed Deploy, Move/Fly, or Push completes before this explosion stage starts; the slash/health countdown waits for both stages. The acting player's already-completed staged action is not replayed before the explosion.

### Fire Magic and ranged attacks

- Fire Magic uses `fire.png`; ranged attacks use `arrow.png`.
- The renderer creates one parallel projectile lane per point of effective damage, including staged upgrade and aura bonuses and authoritative confirmed-effect damage.
- Instant ranged, death-ranged, and instant magic resolutions reconstruct their source, damage, and target from the before/after authoritative snapshots and run the shared projectile head and trail for one cycle only. Their damage/death presentation is delayed until that flight impacts; repeated instant shots receive separate revision-keyed cycles.
- Every lane uses the same reusable quadratic trajectory model as Bomb; the model supplies path data, sampled positions, and tangent angles.
- Elongated arrows/fireballs rotate continuously so their long side follows the curve tangent.
- Sampled tangent angles are unwrapped across the `-180°/180°` boundary before Web Animations interpolation, preventing a one-frame long-way rotation on leftward curves.
- Translation and opacity animate on an outer SVG group while tangent rotation animates on a centered inner group; combining them on one group rotates its board-position transform and can move the projectile off-screen.
- Projectiles materialize over the first 18% of travel, continue source-to-target at full opacity, dissolve at impact, wait through a one-second empty buffer, and restart while the staged or confirmed delayed effect exists.
- The active player's preview and confirmed delayed effect share one stable cycle, so confirmation does not restart the volley. The opponent begins the loop only after confirmation. Both presentations end when the authoritative delayed damage resolves.
- Each lane approximates its curve with eight tangent-aligned `trail.png` texture segments instead of deforming a bitmap or animating many SVG points. Segments render 9px thick at up to 78% opacity; a segment begins fading when its projectile passes it and lasts 0.5 seconds.
- Every lane has one arrow/fireball head painted above and immediately ahead of its trail. Because lane count equals effective damage, a three-damage action displays three projectile heads and three independent segmented trails.
- Reduced-motion mode shows the parallel projectiles statically at the target without trails or repetition.
- Physical ranged Attack reveals the target's physical combat modifier after the first projectile arrival. It sits one standard info-row below health, matching bash spacing, and remains visible while the delayed Attack effect is pending. Magic uses and consumes the separate magic modifier; Cannon and Bomb ignore both modifiers.
- Attack qualifiers are shown immediately before the ranged icon in card, board, and detail text: `P🏹` is Pierce and `F🏹` is instant/fast. Pierce attacks do not show or animate the target's physical modifier because it is ignored during resolution.
- When delayed Attack or Magic resolves, `slash.png` sweeps over the health/modifier region for 1.5 seconds by revealing top-to-bottom and clipping away top-to-bottom. The browser derives the animation from consecutive authoritative snapshots rather than predicting resolution.
- The slash overlay keeps actual and total health visible as `N ♥ M` throughout, using the same red/blue health color as the permanent row. For delayed presentation stages such as a Bomb explosion or replayed projectile flight, it hides the already-updated authoritative row immediately and holds the old health value until the slash begins, preventing a new→old→new flash. Physical Attack counts the displayed modifier toward zero first and then decreases only `N`; Magic has no modifier and begins decreasing `N` directly. At the exact end of the slash, the modifier is removed and a surviving troop's overlay remains at the final authoritative value until the next ordinary board render. A defeated troop removes the health overlay before its death stage.
- If delayed damage lands on a troop that occupied a bash in the preceding snapshot, its slash counter retains that troop's left/right bash position and compact `♥ N` format. Only the affected participant's underlying bash health is hidden, so an exploding bomb reads like damage within the existing split presentation instead of flashing a centered full-health row.
- Bomb and Cannon are hex-resolved effects, so their animation targets come from the post-action board rather than the troop positions in the preceding snapshot. A troop that Moves, Flies, is Pushed, or otherwise enters an affected hex first completes that motion, remains at its authoritative destination through the explosion, and then receives an independent slash/countdown using its pre-damage health. Every final occupant in the affected area gets its own damage presentation.
- When authoritative damage removes a troop, the renderer retains a temporary copy of its card through the slash. After the slash, a predecoded 68px `skull.png` reveals over the card from top to bottom; once fully revealed, the skull and retained card fade together. The complete death stage lasts 1.1 seconds and then both temporary nodes are removed.
- The retained card and skull belong to the impacted hex, not the removed troop node, so selection, hover, and ordinary snapshot rerenders cannot truncate the death stage.

### Cannon

- Cannon uses one `cannon-purple.png` projectile for the whole selected straight line, from the firing troop to the line endpoint. It does not create one projectile per damage point or draw a segmented trail.
- The cannonball uses the shared materialize/travel/impact-fade/buffer cycle, but follows a straight trajectory and remains upright. It repeats throughout the active player's staged preview, keeps the same phase through confirmation, starts for the opponent on confirmation, and ends for both players when the authoritative Cannon effects resolve.
- Cannon has no hover rewind. Its authoritative per-hex effects are grouped by owner and source solely for rendering; rules and damage remain server-authoritative.
- Cannon resolution joins the delayed black-magic damage presentation for every occupied line hex, including friendly troops, visible nonlethal health loss, and the retained-card death sequence. It does not use the physical combat modifier; magic modifiers reduce the blast and are consumed, and Obsidian blocks it unless the blast pierces.

### Gore

- Gore uses `M🐏N`: confirmation records a delayed straight charge without moving the troop. The line may cross occupied hexes, although a friendly final destination is invalid.
- The staged preview uses one upright `horns.png` head with Cannon's straight, repeating materialize/travel/impact cycle and no trail. The horns keep repeating from the stationary source through the opponent's turn. Once that opponent completes an action, the troop moves to the selected endpoint, every enemy recorded along the line receives the normal physical slash/health presentation, and an occupied endpoint starts the ordinary bash flow. Movement precedes the damage and bash playback.
- Gore damage is modifier- and shield-aware physical damage. It does not damage friendly troops or empty hexes, and it is skipped if its enemy target moves away before resolution.

### Defense and Self Defense

- `shield-0.png` through `shield-6.png` form a one-shot seven-frame shield sequence centered on the protected hex.
- Permanent physical or magic `+N` modifier changes do not play shield frames. Triggered physical shield additions, including Tortoise Emperor's adjacent End shelter, are detected from authoritative shield arrays and play the standard non-purple sequence on every recipient.
- A confirmed shield is a property of the receiving troop, not of its hex. It follows the troop when the troop moves, survives opponent-end and unrelated magic/cannon/bomb resolution, and is consumed when a physical attack resolves over that troop or when the troop performs a true action. Optional/triggered resolution actions such as End: move 1 do not consume it.
- A troop with a magic modifier shows its stats as `+physical +magic`, with the magic value colored purple and given the same dark stroke/paint order as the physical value; physical zero remains visible as `+0`, and there is no separate right-side shield icon. Printed trigger rows use the same purple treatment for their magic component. Magic Defense uses the same seven-frame shield sequence and allied flight as physical Defense with a purple filter for staged, confirmed-opponent, triggered-gain, and turn-replay presentation, without duplicating the confirming player's staged animation.
- Magic Defense uses the same target highlighting and shield-sequence timing as Defense, but the sequence and persistent shield icon receive the purple magic filter. Self-Magic Defense is shown as a separate self action only when the card supports it.
- Permanent event modifiers are rendered in the modifier line: physical values use the existing magenta treatment, magic values use purple, and a combined value is shown as `+M+N`. Static keyword passives such as Obsidian, Titanium, First Strike, and Steady derive their compact and full descriptions from the shared passive registry; they are catalogue rules rather than separate board overlays.
- Triggered Frosthorn Pull choices use the existing Pull target/destination projection, while target-specific hit Stun is represented by the existing Stun effect and click replay.
- Every input-bearing triggered action includes a visible Skip control and can be skipped with Space. Start-trigger prompts explicitly say that resolving or skipping the trigger returns to the player's normal turn.
- All shield frames are retained in preload images and explicitly decoded before the application becomes interactive. Their discrete display windows are only 150 ms, so starting downloads without awaiting decoding can otherwise skip or flash frames on the first shield playback.
- Self Defense plays the sequence directly in the source troop's hex.
- Defense targeting another troop materializes one front-facing `shield-3.png` over the first 18% of its shared quadratic trajectory at 50% of the in-hex sequence size, then plays the full-size frame sequence once at the target on arrival. The shield and impact do not loop, but the shared segmented pencil trace repeats so the shielding troop remains identifiable as the source.
- The active player sees the presentation from the staged local preview. The confirming player does not replay it after confirmation; the opponent receives one authoritative playback on the confirming revision.
- Reduced-motion mode omits the flight and briefly presents the front-facing shield at the target.

### Upgrade

- Upgrade uses `upgrade.png` as a single upright object on the shared curved trajectory. The active player sees the staged trajectory, while the confirmed action launches one head without replaying it continuously.
- The segmented pencil trace continues after impact and remains visible through the opponent's response and the upgrading player's next action, then disappears when that next turn action ends. The source coordinate is cached so ordinary rerenders do not relocate the trace.
- Reduced-motion mode shows the upgrade object statically at the target and omits the trail.

### Mending

- Mending uses the standard Unicode red heart `U+2764 U+FE0F` (`❤️`) as SVG text so the flight and target sweep render consistently across browsers.
- During the active player's staged preview, the heart repeatedly follows the shared curved trajectory and segmented trail from the source troop center to the target troop center. The target sweep plays only after the first arrival, even when a selection echo rebuilds the repeating flight.
- The target heart appears with a quick overshoot, beats twice, and fades out over 1.5 seconds at the healed troop.
- After confirmation, the acting client does not replay the presentation. The opponent sees one heart flight with a one-shot trail, followed by one complete target pulse.
- Reduced-motion mode places the flight heart at the target and presents the target heart without motion.

## Animation backlog

- [ ] Death presentation for resolution paths that do not use the delayed damage/slash pipeline, including instant ranged triggers.
- [ ] Defense and Self Defense consumption/removal presentation.
- [x] Upgrade application.
- [ ] Optional End Move / Decline End Move resolution.
- [ ] Instant ranged and death-triggered ranged resolution.
- [ ] Revive resolution.
- [ ] Pass-turn/last-actor availability transition.

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
