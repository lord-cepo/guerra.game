# Server scaffold

Run `npm run build` once, then run `npm start` and open <http://localhost:3000>.

The server provides static files, `GET /api/health`, nickname login, and four server-saved decks per nickname in `data/users.json`.

It also has an in-memory authoritative match service. Create a match with `POST /api/matches`, then connect each player to `ws://localhost:3000/ws` and send:

```json
{ "type": "join", "matchId": "…", "nickname": "your-name" }
```

The server broadcasts `{ "type": "state", "match": { … } }` after joining and after each accepted action. It is a complete snapshot, so a reconnected browser can discard its old state and redraw directly from the newest message:

```json
{ "type": "action", "matchId": "…", "action": { "type": "deploy", "troopId": "p1-hero", "coordinate": "1,2" } }
```

State messages contain:

- `id`, `format`, `revision`, `status`, `activePlayer`, `winner`, `players`, and `ready`;
- `decks` for both players;
- `units`, each with a stable match-scoped `id` such as `"1:p1-hero"`, its card `troopId`, owner, coordinate, permanent damage, and `currentHealth`;
- `defeatedTroopIds` (these are also owner-scoped unit IDs), pending `effects`, pending `bashes`, `lastActingTroopId`, and the revisioned `events` action log;
- `control`, containing the current score and controller for every board region.

The card ID is not itself a unit identity: both players may bring the same card. `units[].id`, `effects[].sourceUnitId`, and bash attacker/defender IDs are used wherever the state needs to identify a particular deployed card. Invalid WebSocket messages return:

```json
{ "type": "error", "message": "Human-readable validation error" }
```

Accepted action messages include `deploy`, `move`, `fly`, `attack`, `cannon`, `push`, `magic`, `mending`, `upgrade`, `defense`, and `self-defense`, each with `troopId`; all except `self-defense` also include `coordinate`. `mending` and `upgrade` target a friendly deployed unit.

Sandbox also exposes `pass`, which has no `troopId` and simply advances to the other player's turn.

The shared card catalog is in `game/cards.ts`; both the client and server use it rather than duplicate card definitions.

Temples are a card role with the same board presence and control contribution as a troop, but no move action. Their active abilities can include **M❤️N** (mend M permanent damage at range N) and **M🔮N** (grant +M to the target's next active ability's left number and +N to its right number). Either upgrade side can be omitted: `M🔮` or `🔮N`.

## One-browser sandbox

The **Sandbox** menu starts an authoritative game that a single logged-in
browser can operate. Both Red and Blue receive the complete card catalogue in
the same scrollable tray layout used by the deck builder, and the action bar
has **Control Red/Blue** to swap sides between turns. Use **Save sandbox** to
write a checkpoint, then choose **Load saved sandbox** from the Sandbox menu
to restore it later (including after a server restart).

Enable **Free placement** in the sandbox action bar to drag any card from
either tray onto any playable board hex. It bypasses turn order, deployment
regions, and card ownership restrictions; dropping onto an occupied hex swaps
the dragged troop with its occupant when possible, or replaces that occupant.

The corresponding API is `POST /api/sandbox` to start, `POST
/api/sandbox/:id/side` to change the controlled side, `POST
/api/sandbox/:id/save` to save, and `POST /api/sandbox/load` to load. Sandbox
checkpoints are stored per nickname under `data/sandboxes/` and contain the
complete server-rendered match state.

The next step is to make the browser render this snapshot and submit actions over WebSocket instead of resolving game state locally.
