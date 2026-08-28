# Current development state

This is a concise handoff, not a changelog. Update it when a feature group or architectural assumption changes.

## Product state

- Browser turn-based strategy game with 8- and 10-card decks.
- The deck builder includes a live search field. Plain terms match card names/IDs; `t:<action>` filters cards by active or triggered action kind, with aliases such as `t:fire`/`t:magic` and `t:ranged`/`t:attack`.
- Authoritative Node/WebSocket match server.
- Developer Playground can control both sides, freely place troops, save/load checkpoints, undo, and pass turns.
- Board uses hand-drawn parchment artwork, control-colored PNG hexes, card pictures, and turn-colored frame jewels.
- Board geometry, descriptions, cards, grid construction, staged projections, deck-builder state, application screens, browser runtime support, match lifecycle, animation timing/projectiles, authoritative revision reconciliation, combat projection, inspection playback, unit/effect rendering, and board-action staging live in focused client modules. `hex-grid.ts` is now a 460-line composition root; every browser TypeScript source file is below 500 lines.
- Engine tests are separated into catalogue/triggers, deployment/control, combat, actions/movement, and advanced-effects files with fresh per-file card fixtures; focused failures no longer run or print the entire engine suite.

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

- Deployment fall/materialization, including opponent-only confirmation playback and a continuous reversible `undeployed ↔ deployed` replay timeline started by left-clicking an inactive troop whose own latest action was Deploy.
- Replay inspection is available independently for both inactive troops and starts explicitly with a left click; ordinary hover only shows the troop/hex details.
- Selecting a troop suspends rewind inspection and returns any open inspection toward authoritative state until the selection is cleared.
- Staged and confirmed bash hexes disable participant rewind and retain the split-bash left/right hover animation.
- Move/Fly dissolve and translated source/destination transition.
- Straight-line ease-out Push animation.
- Pull uses the Push action's opposite displacement direction and reuses its preview, confirmed animation, and click replay. It travels the full printed distance toward and, when necessary, through the acting troop; only the final landing hex determines occupancy or bash. Ordinary Pull staging softly marks the complete selected-target-to-destination line, while triggered Pull retains its endpoint-only preview.
- Stun is available as `N🚫M`, immediately clears the target's physical shield modifier and magic modifier, prevents that troop from acting for N of its own turns, and plays one full upright rotation of a 1.5× `assets/stun.png` over the target hex with gradual fade-in/fade-out.
- Confirmed Move/Fly/Push playback is opponent-only; left-click inspection uses a continuous origin/destination dissolve slider that can reverse repeatedly from its current position.
- Push click inspection uses a continuous reversible pre-push/destination timeline controlled from the inactive pushing troop.
- Push and Pull can target bombs. A bomb follows the straight-line preview and opponent/replay animation; landing on another bomb merges them into one fixed bomb whose damage is the sum of both values. A Bomb action thrown onto an occupied bomb hex merges the same way. Bomb Push does not add hover rewind.
- Split bash pictures with reversible left/right inspection. Blue is fixed to the left and Red to the right, matching their screen trays. For movement-created bashes, the defender stays still while only the attacker's half materializes; retargeting and deselection dissolve from the visible preview position and preserve half clipping when leaving a bash preview. Deselection simultaneously materializes the troop back at its authoritative position.
- Boar Warlord is a 3-health hero that may move 1 hex at Start and permanently gains +1 physical and +1 magic modifier each time it enters a bash; those permanent values appear in the split-bash stat rows like any other troop's modifiers. Triggered moves (Start stride, End stride) are always optional and can be declined.
- Troops can carry a separate magic modifier. The board modifier line shows a lone magic modifier as `+N` and combines physical and magic values as `+M+N`; magic damage spends and removes only the magic modifier, while physical attacks and true actions do not.
- Magic modifiers use a black-outlined purple value in the board modifier line, with no separate shield icon beside the hex. A troop with magic modifier always displays an explicit `+physical +magic` pair, including `+0` physical. Printed trigger lines with physical/magic modifier pairs, such as Duelist Scorpion's `Deploy: +3 +3`, color the magic value purple too. Ordinary permanent modifier gains do not play shield animation; Tortoise Emperor's actual adjacent physical shields play the standard shield sequence on every recipient.
- Magic Defense is available as a separate `N🛡️M` action using the purple magic-shield presentation. Its shield glyph is purple in deck, tray, hover, action-button, and board summaries. It targets any friendly troop in range, while `self-magic-defense` is offered only to cards that explicitly define a self-magic-defense value and resolves without coordinate-range validation. Both staged and opponent-confirmed Magic Block actions run the purple flight/frame animation. Side-tray cards derive both Self Defense and Self Magic Defense summaries from these card capabilities, matching deployed board information; identical shield values stay separate lines with the magic shield rendered purple.
- The current troop catalogue includes Merino Ram, Prism Moth, Warding Bat, Arcane Viper, Komodo Dragon, Ironhide Boar Pup, Needle Mantis, Deep Ocean Octopus, Thornback Archer, Spellshield Beetle, Obsidian Lizard, and Battle Magpie. Their printed fast (`F`), pierce (`P`), Gore, Pull, magic-defense, and trigger effects use the same authoritative action system as the original catalogue.
- The stun expansion adds Thunder Toad, Bellwing Crane, Frosthorn Yak, Duelist Scorpion, Needle Peacock, and Iron Bell Golem. Frosthorn’s Start Pull can select either a friendly or enemy troop within range and resolves through an authoritative pending choice; Needle Peacock’s hit-triggered Stun uses the same choice system, while deployment triggers apply immediately when the troop enters play.
- Thunder Toad gains a permanent +1 physical modifier after using Stun, and Bellwing Crane has a Start `1🚫1` trigger. Compact card and hex information includes `Move 0` only for immobile non-Fly troops; Fly cards and temples omit it, while repeated printed effects are collapsed.
- Colon-triggered modifiers are permanent combat bonuses: physical bonuses appear magenta, magic bonuses purple, and both are cleared by Stun while the control modifier remains. Deck-builder and tray card summaries also color the magic value purple, including the second value of combined physical/magic modifier gains. Obsidian troops are immune to magic damage sources. Titanium is the physical-damage immunity flag and is honored by delayed physical attacks and Gore.
- Constant-size Bomb projectile preview that materializes at the trajectory start, has no damage label, uses a one-shot confirmed launch that reveals the persistent bomb/damage label only on arrival, and retains a repeating cached-origin segmented trace.
- A confirmed Bomb trace persists while its throwing troop remains inactive and stops when another troop action makes the bomber active again; Bomb has no hover rewind.
- Upgrade uses `upgrade.png` as a one-time upright thrown object with the shared curved trajectory and a repeating cached-origin segmented trace. The trace remains through the opponent's response and the upgrading player's next action, then stops when that next action ends.
- Fire Magic staged onto an inert bomb redirects its curved lanes to the offset bomb icon, repeats the volley, and crossfades the fixed entity from `bomb-unlight.png` to `bomb-light.png` over 350 ms on first impact. After confirmation, authoritative explosion effects preserve the lit-bomb projection; the acting player keeps the previewed lit result, while the opponent sees one fire flight to the bomb and the impact-timed crossfade. Both players then retain one repeating caster-to-bomb pencil trajectory without a repeated projectile head until the bomb explodes.
- Instant fire magic (`F🔥`) detonates the bomb it touches immediately instead of leaving it lit. Pierce fire lights a bomb whose blast ignores Obsidian magic immunity and displays its damage as `NP` beside the bomb icon. Mole Artificer's fire is piercing: direct damage ignores the magic shield, and bombs it lights display `NP`.
- Bomb resolution presents one large 120px `explosion-purple.png` horizontally centered on each resolving bomb-origin hex and shifted 20px upward for 900 ms. The origin and all six adjacent hexes are washed purple at 25% alpha above their occupants, using exactly the same reveal, hold, and fade timeline as the explosion. In opponent playback and `ArrowLeft` replay, a one-time Deploy, Move/Fly, or Push finishes before the explosion begins; damage slash/countdown follows the explosion. The confirming player proceeds directly from its completed preview to the explosion without replaying the action.
- Bomb explosions ignite inert bombs on affected tiles. Each reached bomb becomes a fresh delayed seven-hex explosion and resolves after the following player's action, allowing lines or clusters of bombs to chain one turn at a time rather than detonating recursively in one resolution.
- One-shot Defense/Self Defense presentation using retained, startup-decoded `shield-0.png` through `shield-6.png` frames at 150 ms per step: Self Defense animates in place, while allied Defense materializes `shield-3.png` over the first 18% of the shared curved trajectory before the target sequence. Confirmed shields are stored on troops and follow them instead of remaining on their hex; physical attacks resolving over the troop and true troop actions consume them, while triggered resolution actions such as End: move 1 do not. Awaiting decode prevents first-play frame flashes. Its segmented pencil trace repeats to keep the shielding source clear, without relaunching the shield or replaying impact. The active player sees the staged preview and the opponent sees the confirmed action once.
- Mending launches the standard Unicode ❤️ over the shared curved trajectory. The active preview repeats the flight but plays a 1.5-second target-heart pulse (appear, beat twice, fade) only on first arrival; after confirmation, only the opponent sees one complete flight-and-pulse presentation.
- Repeating curved Fire Magic and ranged volleys with one visible arrow/fireball head per damage point, materializing over the first 18% of travel and painted ahead of an independent eight-segment `trail.png` lane rendered 9px thick at up to 78% opacity and fading over 0.5 seconds, plus impact dissolve, a one-second buffer, and restart while delayed damage remains pending. Tangent angles are unwrapped before interpolation so leftward paths do not briefly flip at the ±180° boundary. Physical ranged Attack reveals the target's signed modifier directly below health after first impact and keeps it visible while damage is pending.
- Fire Magic and ranged confirmation preserves the acting player's current loop phase; the opponent starts the loop only on confirmation, and both stop when damage resolves.
- Cannon presents one upright `cannon-purple.png` projectile moving along the selected straight line without a segmented trail. It repeats with the Fire Magic/ranged lifecycle, has no rewind, and stops when its delayed effects resolve. Its black-magic damage affects friendly and enemy troops on the line, ignores physical modifiers but is reduced by magic shields, and uses the visible health/slash and lethal-card sequence, including nonlethal permanent damage.
- Gore uses the emoji-rendered `M🐏N`: target selection shifts the troop to the endpoint for the acting player's preview while a direction-rotated, 1.8× `horns.png` repeats along the aligned line. Confirmation moves the authoritative troop immediately, starts any destination bash, and lets the opponent see the source-to-endpoint movement; both players retain the horns until the opponent completes a true action. Gore then deals modifier-aware physical damage and slash/health playback to every recorded enemy path target without moving the troop again. Each damaging hit independently activates hit passives, so Ironhide Boar Pup gains +1 physical and +1 magic modifier per troop damaged. The line may cross friendly troops but cannot end on one.
- Attack qualifiers now support Pierce and instant/fast display: Pierce attacks resolve their full physical value without the target's physical modifier and are displayed as `P🏹`; instant attacks are displayed as `F🏹` (and both prefixes can appear together).
- Raven Prince now has `End: 1🚫1`: at End it selects an enemy troop within 1, stuns it for 1 turn, and clears its shields and modifiers.
- Left-clicking a stunned troop replays its enlarged, gradual-fade `stun.png` rotation over the troop's hex.
- Authoritative ranged Attack/Magic resolution uses a 1.5-second top-to-bottom `slash.png` sweep over the health region. Its overlay keeps `actual ♥ total` visible in the permanent health color; Physical Attack spends modifier first and then decreases actual health, while Magic decreases actual health directly. At completion the modifier disappears and a surviving troop keeps the final authoritative health overlay until the next ordinary board render, so the health text cannot remain blank after resolution or replay.
- Damage resolving on a troop in a bash keeps the split-side `♥ actual` label and countdown for that participant; it does not introduce a centered `actual ♥ total` overlay over the contested hex.
- Hex-resolved Bomb and Cannon presentation targets the occupants after the triggering action. Troops entering the affected area therefore complete movement first, see the explosion second, and receive independent slash/health countdowns last; their old health is recovered from the pre-action snapshot instead of displaying the already-reduced authoritative value.
- Lethal delayed Attack, Magic, and Bomb damage retains the defeated card through the slash, then reveals the predecoded 68px `skull.png` from top to bottom. Once revealed, skull and card fade together over the remainder of the 1.1-second death stage.
- Lethal retained-card/skull playback is hex-owned and survives unrelated board rerenders.
- Bash resolution sequences an applicable confirmed shield, slash/health countdown using only each participant's compact `♥ actual` value, and finally a slider that hides the defeated half. The surviving troop then returns to the normal single-card `actual ♥ starting` display; a tie hides both halves.
- Static troop keywords use the structured `passives` list. First Strike, Obsidian, Titanium, and Steady share generated compact/full descriptions with their authoritative engine lookup, removing per-card boolean flags, hard-coded card IDs, and repeated keyword descriptions. In a First Strike bash, the enemy is slashed first; a surviving enemy retaliates with a second slash against the First Strike troop, while a defeated enemy deals no retaliation damage.
- Triggered actions with no legal target are skipped automatically. Choices with at least one legal target open on their target action, highlight the legal hexes immediately, and can still be skipped with their button or Space. Saved playgrounds paused on a trigger restore its owner, source selection, and legal targets. Start triggers such as Frosthorn Yak's Pull resume the same player's normal action phase and do not make the source troop inactive; End/death triggers still complete the current turn after resolution. Trigger-specific prompts identify Pull, Stun, Revive, and attack choices instead of falling through to a Revive label.
- Triggered Move and Pull choices reuse the normal animated movement/bash preview and opponent confirmation playback. Triggered instant/death projectiles preview from their authoritative pending origin and damage, and triggered Stun animates on its staged target as well as after confirmation.
- Frosthorn Pull presents an explicit troop chooser when both Bash participants share the selected hex. Tortoise Emperor shield playback includes newly deployed recipients, delayed behind opponent-visible deployment. Delayed Attack/Magic trajectories retain their recorded origin if the source disappears, and physical modifier overlays are suppressed as soon as their tracked target leaves the threatened hex or Bash.
- While a pending triggered action is awaiting input, its living source troop is covered by a translucent yellow (`0.4` alpha) wash so the required actor remains visually identifiable.
- Resolving instant ranged, death-ranged, or instant magic damage plays the normal arrow/fire projectile exactly once from the pending effect's recorded origin to the chosen hex. The usual slash, health countdown, and death presentation wait for that one flight to impact.
- Titanium prevents physical Attack and Gore hits without consuming the immune troop's shield. Obsidian prevents magic and black-magic damage without consuming its magic modifier.
- Legal action highlighting takes priority over inactive/last-acting hex cleanup. In the saved playground, Merino Ram at `-3,-1` visibly exposes and can select its full-range Gore target at `0,2`, even though Deep Ocean Octopus is the opponent's last-acting troop.
- A lit bomb remains pending through Start-trigger choices because those are not response actions. It resolves after the active player's subsequent true action or normal pass.
- Bash slash/slider playback requires a new matching authoritative `bashResolved` trigger; a defender leaving the contested hex emits `bashRetreat` and removes the bash without playing the combat animation.
- Bash timing is End-gated: every new bash waits until an End phase has completed, then resolves in the first following combat-resolve phase. This applies equally to action-, Start-, and End-trigger-created bashes and gives the player acting after that End phase a chance to move either controlled participant out of the contested hex.
- Bash physical/magic modifier pairs are centered as a single stat row beneath health, preventing the magic value from overflowing the outer edge.
- Moving or pulling either participant out of a Bash hides the old split immediately during preview and after confirmation, including Frosthorn Yak pulling an enemy attacker directly into a different Bash.

See `docs/board-rendering.md` for behavior and implementation constraints.
The remaining action/preview animation work is tracked in its **Animation backlog** checklist.

## Assets and conventions

- Card artwork is discovered from `assets/cards/<card-id>.png`; Mole Artificer and Duelist Scorpion artwork now use their catalogue IDs directly rather than misspelled or reversed filenames. Missing or invalid artwork falls back to the troop illustration; the blank Frosthorn Yak and Deep Ocean Octopus exports are retained under diagnostic filenames instead of masking that fallback with white images.
- Card descriptions use `~...~` to mark magic-modifier text explicitly (for example, `+1 ~+1~`). Renderers remove the marker and display its contents in purple with the surrounding Kalam typography; coloring no longer depends on matching a description line to a trigger by array position.
- Known spelling aliases should stay explicit and minimal.
- `frame_bg_sat.png` is the current board-frame base.
- `frame_jewel_red.png` and `frame_jewel_blue.png` indicate active player.
- `card_frame.png` and `button.png` provide hand-drawn UI frames.
- `bomb-unlight.png` is used for inert bombs; `bomb-light.png` is used for Fire Magic and chain-reaction lit bombs.

## Known technical pressure points

- `hex-grid.html` still combines application markup and a large stylesheet; the TypeScript browser controller has been split at renderer and interaction boundaries.
- Full board re-rendering can restart transient animations.
- SVG clipping, paint order, CSS transforms, and Web Animations still interact in non-obvious ways.
- Live-match `runtime.json` loading and saving is temporarily disabled; restarts intentionally discard active matches and queues, while user decks, saved Playgrounds, and the ten newest diagnostic match logs still persist. Existing runtime files are left untouched. The dormant runtime path retains bounded compact diagnostics and atomic primary/backup writes for future re-enablement. The menu no longer offers Resume Match, while Resume Playground remains available for the current in-memory sandbox session.
- Visual behavior lacks deterministic automated browser scenarios.

## Recommended next engineering steps

1. Add deterministic Playground fixtures for deploy, move, push, bash, and bomb states.
2. Add screenshot/interaction regression checks for those fixtures.
3. Make runtime persistence atomic and serialized, then add a regression test for concurrent saves.
4. Split the application stylesheet from `hex-grid.html` when working on a dedicated presentation refactor.
5. Add a small `npm run verify` workflow for check, build, tests, and `git diff --check`.

## Handoff protocol

At the end of a substantial task:

1. Run appropriate checks.
2. Visually verify interactive changes.
3. Update this file only if current behavior, architecture, or next priorities materially changed.
4. Record unrelated failures separately rather than rewriting history here.
