# Current development state

This is a concise handoff, not a changelog. Update it when a feature group or architectural assumption changes.

## Product state

- Browser turn-based strategy game with 8- and 10-card decks.
- The deck builder includes a live search field. Plain terms match card names/IDs; `t:<action>` filters cards by active or triggered action kind, with aliases such as `t:fire`/`t:magic` and `t:ranged`/`t:attack`.
- Authoritative Node/WebSocket match server.
- Developer Playground can control both sides, freely place troops, save/load checkpoints, undo, and pass turns.
- Board uses hand-drawn parchment artwork, control-colored PNG hexes, card pictures, and turn-colored frame jewels.

## Board presentation

- Player 1 / Red is conceptually left; Player 2 / Blue is right.
- Front-line control uses the dark version of the controlling player's color.
- SVG interaction borders are disabled; PNG assets own visible hex borders.
- Available target hexes ease over 1 second to a 5% smaller position shifted 3px toward browser `+Y`, then return to neutral when selected or unavailable. Available targets use a 24%-opacity white wash; other static highlighting remains hidden for paths, push endpoints, cannon lines, confirmed effects, and last actions.
- The only hex washes are white for availability and black for direct hover; staged and confirmed action targets do not retain red, blue, or neutral fills.
- Generic numeric damage previews are hidden. Bash retains its animated health/modifier presentation, and bombs retain their persistent damage label.
- Inactive troop artwork uses a warm parchment-grayscale treatment with a neutral grey wash at 50% alpha, below its info frame and text.
- Slow Playground HTTP operations (new, load, save, and undo) show the browser's rolling progress cursor until completion.
- The board's double-click troop information dialog is temporarily disabled.
- Every occupied hex keeps `actual ♥ total` and its signed modifier together in the upper stat area, while the lower compact information area always has three ability/effect rows; overflow is indicated by `...` at the end of the third information row.
- Board health always uses `N ♥ M`, with current health before the heart and total health after it, including at full health.
- Side-tray and hover cards show only `♥ M` while unwounded; once wounded they show `N ♥ M`. Board hex health remains in the full form at all times.
- Post-damage health uses authoritative `currentHealth`; temporary slash/bash counters are removed at animation completion so they cannot cover or hide the restored health row.
- Number keys select the visible troop actions: `1` selects Move, and `2` onward follow the displayed action-button order.
- Pressing `ArrowLeft` replays the latest completed turn animation seen by the client without changing authoritative state or the current troop/action selection. Local and opposing actions use the same replay path. Any earlier pending ranged, Fire Magic, or Cannon effects resolved by that turn replay their source-to-target flights first, followed by the resulting slash/health animations.

## Implemented previews and animations

- Deployment fall/materialization, including opponent-only confirmation playback and a continuous reversible `undeployed ↔ deployed` hover timeline for every inactive troop whose own latest action was Deploy.
- Rewind inspection is available independently for both inactive troops: the local action arms on its first pointer exit (or automatically after a newer action), the opponent action is immediately hoverable, and a completed inspector cannot block switching to the other troop.
- Selecting a troop suspends rewind inspection and returns any open inspection toward authoritative state until the selection is cleared.
- Staged and confirmed bash hexes disable participant rewind and retain the split-bash left/right hover animation.
- Move/Fly dissolve and translated source/destination transition.
- Straight-line ease-out Push animation.
- Pull uses the Push action's opposite displacement direction and reuses its preview, confirmed animation, and hover replay.
- Stun is available as `N🚫M`, immediately clears the target's physical shield modifier and magic modifier, prevents that troop from acting for N of its own turns, and plays one full upright rotation of a 1.5× `assets/stun.png` over the target hex with gradual fade-in/fade-out.
- Confirmed Move/Fly/Push playback is opponent-only; Move/Fly hover inspection uses a continuous origin/destination dissolve slider that can reverse repeatedly from its current position.
- Push hover inspection uses a continuous reversible pre-push/destination timeline controlled from the inactive pushing troop.
- Push can target a bomb. The bomb follows the straight-line preview and opponent/replay animation; landing on another bomb merges them into one fixed bomb whose damage is the sum of both values. Bomb Push does not add hover rewind.
- Split bash pictures with reversible left/right inspection. Blue is fixed to the left and Red to the right, matching their screen trays. For movement-created bashes, the defender stays still while only the attacker's half materializes; retargeting and deselection dissolve from the visible preview position and preserve half clipping when leaving a bash preview. Deselection simultaneously materializes the troop back at its authoritative position.
- Boar Warlord split-bash hex info shows the current `+N if ⚔️` bonus; once its permanent post-bash bonus exceeds the initial +1, that row is magenta like an upgraded effect.
- Troops can carry a separate magic modifier. The board modifier line shows a lone magic modifier as `+N` and combines physical and magic values as `+M+N`; magic damage spends and removes only the magic modifier, while physical attacks and true actions do not.
- Magic modifiers are marked by a purple-filtered `🛡️` beside the board modifier line. Their gain animation reuses the physical shield sequence with a purple image filter, and turn replay shows that sequence directly on the target hex.
- Magic Defense is available as a separate `N🛡️M` action using the purple magic-shield presentation. It targets any friendly troop in range, while `self-magic-defense` is offered only to cards that explicitly define a self-magic-defense value.
- The current troop catalogue includes Merino Ram, Prism Moth, Warding Bat, Arcane Viper, Komodo Dragon, Ironhide Boar Pup, Needle Mantis, Deep Ocean Octopus, Thornback Archer, Spellshield Beetle, Obsidian Lizard, and Battle Magpie. Their printed fast (`F`), pierce (`P`), Gore, Pull, magic-defense, and trigger effects use the same authoritative action system as the original catalogue.
- The stun expansion adds Thunder Toad, Bellwing Crane, Frosthorn Yak, Duelist Scorpion, Needle Peacock, and Iron Bell Golem. Frosthorn’s Start Pull and Needle Peacock’s hit-triggered Stun resolve through authoritative pending choices; deployment triggers apply immediately when the troop enters play.
- Colon-triggered modifiers are permanent combat bonuses: physical bonuses appear magenta, magic bonuses purple, and both are cleared by Stun while the control modifier remains. Obsidian troops are immune to magic damage sources. Titanium is the physical-damage immunity flag and is honored by delayed physical attacks and Gore.
- Constant-size Bomb projectile preview that materializes at the trajectory start, has no damage label, uses a one-shot confirmed launch that reveals the persistent bomb/damage label only on arrival, and retains a repeating cached-origin segmented trace.
- A confirmed Bomb trace persists while its throwing troop remains inactive and stops when another troop action makes the bomber active again; Bomb has no hover rewind.
- Upgrade uses `upgrade.png` as a one-time upright thrown object with the shared curved trajectory and a repeating cached-origin segmented trace. The trace remains through the opponent's response and the upgrading player's next action, then stops when that next action ends.
- Fire Magic staged onto an inert bomb redirects its curved lanes to the offset bomb icon, repeats the volley, and crossfades the fixed entity from `bomb-unlight.png` to `bomb-light.png` over 350 ms on first impact. After confirmation, authoritative explosion effects preserve the lit-bomb projection; the acting player keeps the previewed lit result, while the opponent sees one fire flight to the bomb and the impact-timed crossfade. Both players then retain one repeating caster-to-bomb pencil trajectory without a repeated projectile head until the bomb explodes.
- Bomb resolution presents one large 120px `explosion-purple.png` horizontally centered on each resolving bomb-origin hex and shifted 20px upward for 900 ms. The origin and all six adjacent hexes are washed purple at 25% alpha above their occupants, using exactly the same reveal, hold, and fade timeline as the explosion. In opponent playback and `ArrowLeft` replay, a one-time Deploy, Move/Fly, or Push finishes before the explosion begins; damage slash/countdown follows the explosion. The confirming player proceeds directly from its completed preview to the explosion without replaying the action.
- Bomb explosions ignite inert bombs on affected tiles. Each reached bomb becomes a fresh delayed seven-hex explosion and resolves after the following player's action, allowing lines or clusters of bombs to chain one turn at a time rather than detonating recursively in one resolution.
- One-shot Defense/Self Defense presentation using retained, startup-decoded `shield-0.png` through `shield-6.png` frames at 150 ms per step: Self Defense animates in place, while allied Defense materializes `shield-3.png` over the first 18% of the shared curved trajectory before the target sequence. Confirmed shields are stored on troops and follow them instead of remaining on their hex; physical attacks resolving over the troop and true troop actions consume them, while triggered resolution actions such as End: move 1 do not. Awaiting decode prevents first-play frame flashes. Its segmented pencil trace repeats to keep the shielding source clear, without relaunching the shield or replaying impact. The active player sees the staged preview and the opponent sees the confirmed action once.
- Mending launches the Unicode ❤️‍🩹 heart over the shared curved trajectory. The active preview repeats the flight but plays the slash-style 1.5-second target-heart sweep only on first arrival; after confirmation, only the opponent sees one complete flight-and-sweep presentation.
- Repeating curved Fire Magic and ranged volleys with one visible arrow/fireball head per damage point, materializing over the first 18% of travel and painted ahead of an independent eight-segment `trail.png` lane rendered 9px thick at up to 78% opacity and fading over 0.5 seconds, plus impact dissolve, a one-second buffer, and restart while delayed damage remains pending. Tangent angles are unwrapped before interpolation so leftward paths do not briefly flip at the ±180° boundary. Physical ranged Attack reveals the target's signed modifier directly below health after first impact and keeps it visible while damage is pending.
- Fire Magic and ranged confirmation preserves the acting player's current loop phase; the opponent starts the loop only on confirmation, and both stop when damage resolves.
- Cannon presents one upright `cannon-purple.png` projectile moving along the selected straight line without a segmented trail. It repeats with the Fire Magic/ranged lifecycle, has no rewind, and stops when its delayed effects resolve. Its black-magic damage affects friendly and enemy troops on the line, ignores modifiers and shields, and uses the visible health/slash and lethal-card sequence, including nonlethal permanent damage.
- Gore uses `M🐏N`: the staged preview shows `horns.png` with Cannon's straight motion, while remote confirmation moves the troop to the final clear line hex. An enemy there receives delayed physical damage after the opponent acts; friendly and empty destinations receive no damage, and enemy destinations can start a bash.
- Attack qualifiers now support Pierce and instant/fast display: Pierce attacks resolve their full physical value without the target's physical modifier and are displayed as `P🏹`; instant attacks are displayed as `F🏹` (and both prefixes can appear together).
- Raven Prince now has `End: 1🚫1`: at End it selects an enemy troop within 1, stuns it for 1 turn, and clears its shields and modifiers.
- Hovering a stunned troop replays its enlarged, gradual-fade `stun.png` rotation over the troop's hex.
- Authoritative ranged Attack/Magic resolution uses a 1.5-second top-to-bottom `slash.png` sweep over the health region. Its overlay keeps `actual ♥ total` visible in the permanent health color; Physical Attack spends modifier first and then decreases actual health, while Magic decreases actual health directly. At completion the modifier disappears and a surviving troop keeps the final authoritative health overlay until the next ordinary board render, so the health text cannot remain blank after resolution or replay.
- Damage resolving on a troop in a bash keeps the split-side `♥ actual` label and countdown for that participant; it does not introduce a centered `actual ♥ total` overlay over the contested hex.
- Hex-resolved Bomb and Cannon presentation targets the occupants after the triggering action. Troops entering the affected area therefore complete movement first, see the explosion second, and receive independent slash/health countdowns last; their old health is recovered from the pre-action snapshot instead of displaying the already-reduced authoritative value.
- Lethal delayed Attack, Magic, and Bomb damage retains the defeated card through the slash, then reveals the predecoded 68px `skull.png` from top to bottom. Once revealed, skull and card fade together over the remainder of the 1.1-second death stage.
- Lethal retained-card/skull playback is hex-owned and survives unrelated board rerenders.
- Bash resolution sequences an applicable confirmed shield, slash/health countdown using only each participant's compact `♥ actual` value, and finally a slider that hides the defeated half. The surviving troop then returns to the normal single-card `actual ♥ starting` display; a tie hides both halves.
- First Strike is supported as a troop keyword. In a First Strike bash, the enemy is slashed first; a surviving enemy retaliates with a second slash against the First Strike troop, while a defeated enemy deals no retaliation damage.
- Bash slash/slider playback requires a new matching authoritative `bashResolved` trigger; a defender leaving the contested hex emits `bashRetreat` and removes the bash without playing the combat animation.

See `docs/board-rendering.md` for behavior and implementation constraints.
The remaining action/preview animation work is tracked in its **Animation backlog** checklist.

## Assets and conventions

- Card artwork is discovered from `assets/cards/<card-id>.png`.
- Known spelling aliases should stay explicit and minimal.
- `frame_bg_sat.png` is the current board-frame base.
- `frame_jewel_red.png` and `frame_jewel_blue.png` indicate active player.
- `card_frame.png` and `button.png` provide hand-drawn UI frames.
- `bomb-unlight.png` is used for inert bombs; `bomb-light.png` is used for Fire Magic and chain-reaction lit bombs.

## Known technical pressure points

- `hex-grid.ts` and `hex-grid.html` are large and mix several responsibilities.
- Full board re-rendering can restart transient animations.
- SVG clipping, paint order, CSS transforms, and Web Animations still interact in non-obvious ways.
- `data/runtime.json` can become very large, making shutdown/restart persistence slow. Runtime writes are serialized per server and atomically renamed from a unique per-save temporary file, preventing overlapping server processes from publishing a partially-written shared temp file. The previous valid snapshot is retained as `runtime.backup.json` and used automatically when the primary is missing or malformed.
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
