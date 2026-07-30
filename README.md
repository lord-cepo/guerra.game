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
