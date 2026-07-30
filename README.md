# guerra
A browser turn-based strategy game, with deckbuilding mechanics.

## Rules
Defeat the opponent's **hero** or leave him alone in the board.

Each **unit** has an actual health on the board, **modifiers** are considered as additional temporary health.

You can deploy units or perform actions with them, by moving/attacking.
The actions are:
- **movement** 🥾N: move N steps
- **fly** 🪽N: move over obstacles N steps
- **bow** M🏹N: M physical damage in range N
- **fire magic** M🔥N: M magic damage in range N, fire is effective only if it kills
- **upgrade** L🔮M N: +L&+M to an action for a troop in range N, until the unit performs the action 
- **push** M🫸N: pushes M tiles in a line a unit at distance N
- **cannon** M🧨N: fires M physical damages in a line of length N 
- **shield** M🛡N: +M modifier to a unit in range N

Each **troop** has an implicit 🥾1 (normal movement) and 1🛡0 (self-shield).

The damage types are:
- **physical**: modifiers count for final damage
- **magic**: ignores modifier

A physical damage mechanics, the **bash** ⚔. It triggers a combat once two units are in the same tile.
The actual health + modifiers are compared, at most one unit remains in the tile.
Damages are resolved after the defender's turn, giving him the possibility to respond, by avoiding the damage, or counterattacking or defending the position.
The unit which performed the action is unactive the turn after, it's then an easy target for the opponent!

The **control** guarantees a +1 modifier. There are 6 regions: one starting, two intermediate, one front line, two opponent's intermediate and one opponent's starting.
Each region has 6 tiles, control is calculated by summing the actual health of units and adding a +0.5 to break ties in player's regions.
Units can be usually deployed only in controlled regions, each unit has a specific deployment rule.

## Development

```bash
npm install
npm test
npm start
```

`npm start` builds the TypeScript source into `dist/` and serves the game at
`http://localhost:3000`. The `dist/` folder, dependencies, and local game
data are generated locally.
