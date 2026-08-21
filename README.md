# guerra.game
A browser turn-based strategy game, with deckbuilding mechanics

## Development

```bash
npm install
npm test
npm start
```

`npm start` builds the TypeScript source into `dist/` and serves the game at
`http://localhost:3000`. The `dist/` folder, dependencies, and local game
data are generated locally and intentionally not committed.

### Developer Playground

The Playground is a developer tool for controlling both sides of a match,
testing placements, and saving a board checkpoint. It is hidden and its API is
disabled during a normal start. Enable it for the current server process with:

```bash
npm run start:playground
```

`ENABLE_PLAYGROUND=1 npm start` is equivalent. Once enabled, choose
**Playground** from the start screen. Because the app uses nickname-based login
rather than user roles, this is an instance-wide development flag: do not enable
it on a public server.
## Turn phases

Each turn follows one authoritative sequence:

1. `start` — resolve Start and Opponent Start card effects.
2. `action` — the active player chooses one card action or passes.
3. `action-resolve` — apply that action and its immediate triggers, such as
   movement, Magic use, upgrades, bombs, and deaths caused directly by it.
4. `combat-resolve` — resolve previously declared ranged damage, Magic damage,
   cannon damage, bomb damage, and bashes after the defending player has had
   their action window.
5. `end` — resolve End and Opponent End effects, expire defenses, then hand the
   turn to the other player.

Automatic phases advance immediately. If a card requires a choice, the phase
stays on the timing window that created that choice until it is resolved.

## Card action dictionaries

Active abilities and actions produced by triggered effects use the same shape:

```ts
{
  kind: 'ranged',
  amount: 1,              // optional; may also be an array of numbers
  range: 1,
  type: ['instant', 'optional'] // optional qualifiers
}
```

Move and fly use `range` for their distance and omit `amount`. Multiple numeric
values retain their printed order: upgrades use `[left, right]`, while a
repeated ranged effect uses `[damage, repetitions]`.

## Trigger stack and dashboard

Card triggers are static definitions containing a condition and the normalized
action they produce. Trigger definitions never enter runtime state. When the
current action matches one, its action is instantiated as a dashboard row and
pushed onto the LIFO resolution stack.

Dashboard rows are stored once and progress from trigger checking through
optional player input to resolution. `currentEventId` is the visible `~`
pointer. Each row records its parent, trigger provenance, controller, source
unit, phase, target hexes, and snapshots of units on those hexes. Resolved rows
remain in the dashboard as the permanent action chronology.

Simultaneous triggers are ordered with the active player first and then by that
player's deck order. They are pushed in reverse so LIFO resolution preserves
that priority.
