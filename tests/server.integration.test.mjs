import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';

const root = process.cwd();
const port = 3200 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
const disabledPort = port + 500;
const disabledBase = `http://127.0.0.1:${disabledPort}`;
const deck8 = ['tiger-queen', 'ember-salamander', 'desert-fox', 'snowy-owl', 'canyon-ibex', 'marsh-badger', 'dune-scorpion', 'steppe-lynx'];
const deck10 = [...deck8, 'cave-viper', 'river-otter'];
const json = async (path, options) => { const response = await fetch(`${base}${path}`, options); return { response, body: await response.json() }; };
const waitFor = (socket, description, predicate) => new Promise((resolve, reject) => {
  const received = [];
  const listener = raw => {
    const message = JSON.parse(raw.toString());
    received.push(message.type === 'state' ? { type: message.type, revision: message.match?.revision } : message);
    if (!predicate(message)) return;
    clearTimeout(timeout);
    socket.off('message', listener);
    resolve(message);
  };
  const timeout = setTimeout(() => {
    socket.off('message', listener);
    reject(new Error(`Timed out waiting for ${description}; received ${JSON.stringify(received)}`));
  }, 3000);
  socket.on('message', listener);
});
const noStateChange = socket => new Promise((resolve, reject) => {
  const listener = raw => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'state') { clearTimeout(timeout); socket.off('message', listener); reject(new Error('Unexpected state broadcast.')); }
  };
  const timeout = setTimeout(() => { socket.off('message', listener); resolve(); }, 180);
  socket.on('message', listener);
});

test('Playground is server-gated unless explicitly enabled', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'hex-grid-disabled-playground-test-'));
  const server = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: { ...process.env, PORT: String(disabledPort), DATA_DIR: dataDir, ENABLE_PLAYGROUND: '0' }
  });
  try {
    let stderr = '';
    server.stderr.on('data', data => { stderr += data.toString(); });
    const launchError = await new Promise(resolve => {
      server.stdout.on('data', data => { if (data.toString().includes('listening')) resolve(undefined); });
      server.once('error', error => resolve(error));
      server.once('exit', code => resolve(new Error(`Server exited before listening (code ${code}): ${stderr}`)));
    });
    if (launchError) {
      if (String(launchError).includes('EPERM')) return t.skip('Sandbox forbids binding an integration-test port.');
      throw launchError;
    }
    const configResponse = await fetch(`${disabledBase}/api/config`);
    assert.deepEqual(await configResponse.json(), { playgroundEnabled: false });
    const denied = await fetch(`${disabledBase}/api/sandbox`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: 'developer', format: 8 })
    });
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), { error: 'Playground is disabled on this server.' });
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('queue and WebSocket match integration', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'hex-grid-test-'));
  const server = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ENABLE_PLAYGROUND: '1' }
  });
  try {
    let stderr = '';
    server.stderr.on('data', data => { stderr += data.toString(); });
    const launchError = await new Promise(resolve => {
      server.stdout.on('data', data => { if (data.toString().includes('listening')) resolve(undefined); });
      server.once('error', error => resolve(error));
      server.once('exit', code => resolve(new Error(`Server exited before listening (code ${code}): ${stderr}`)));
    });
    if (launchError) {
      if (String(launchError).includes('EPERM')) return t.skip('Sandbox forbids binding an integration-test port.');
      throw launchError;
    }
    assert.deepEqual((await json('/api/config')).body, { playgroundEnabled: true });
    for (const nickname of ['alice', 'bob', 'charlie', 'mallory']) await json('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname }) });

    // Deck building persists every incremental user edit. A deck needs exactly
    // one hero only when complete, while empty/partial decks may temporarily
    // have none as cards are added and removed.
    const partialDeck = await json('/api/decks/0', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: 'mallory', cards: ['ember-salamander'], format: 8 })
    });
    assert.equal(partialDeck.response.status, 200);
    const loadedPartialDeck = await json('/api/decks?nickname=mallory');
    assert.deepEqual(loadedPartialDeck.body.decks['8'][0], ['ember-salamander']);
    assert.equal((await json('/api/decks/0', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: 'mallory', cards: ['queen-bee', 'tiger-queen'], format: 8 })
    })).response.status, 400, 'a partial deck still cannot contain two heroes');
    assert.equal((await json('/api/decks/0', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: 'mallory', cards: deck10.slice(1, 9), format: 8 })
    })).response.status, 400, 'a completed deck must contain a hero');

    for (const [nickname, cards] of [['alice', deck8], ['bob', deck10], ['charlie', deck8]]) {
      const savedDeck = await json('/api/decks/0', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname, cards, format: cards.length }) });
      assert.equal(savedDeck.response.status, 200);
    }

    // A sandbox is an authoritative match operated by one nickname. Its save
    // file is independent of its transient match id, so loading creates a
    // fresh sandbox with the exact board state.
    const sandbox = (await json('/api/sandbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'alice', format: 8 }) })).body.match;
    assert.equal(sandbox.sandbox, true);
    assert.equal(sandbox.sandboxSide, 2);

    // Exercise every high-level WebSocket interaction used by the board:
    // join, rules-based deployment, sandbox mode/free placement, selection,
    // and a confirmed action.
    const sandboxClient = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise(resolve => sandboxClient.on('open', resolve));
    const sandboxJoined = waitFor(sandboxClient, 'sandbox initial state', message => message.type === 'state' && message.match.id === sandbox.id);
    sandboxClient.send(JSON.stringify({ type: 'join', matchId: sandbox.id, nickname: 'alice' }));
    await sandboxJoined;
    const rulesDeployment = waitFor(sandboxClient, 'rules-based sandbox deployment', message =>
      message.type === 'state'
      && message.match.sandboxFreePlacement === false
      && message.match.revision === 1
      && message.match.units.some(unit => unit.owner === 2 && unit.troopId === 'tiger-queen' && unit.coordinate === '-1,-2')
    );
    sandboxClient.send(JSON.stringify({
      type: 'action', matchId: sandbox.id, action: { type: 'deploy', troopId: 'tiger-queen', coordinate: '-1,-2' }
    }));
    await rulesDeployment;
    const freePlacement = waitFor(sandboxClient, 'sandbox free-placement mode', message => message.type === 'state' && message.match.sandboxFreePlacement === true);
    sandboxClient.send(JSON.stringify({ type: 'sandbox-mode', matchId: sandbox.id, freePlacement: true }));
    await freePlacement;
    const placed = waitFor(sandboxClient, 'sandbox troop placement', message => message.type === 'state' && message.match.units.some(unit => unit.owner === 2 && unit.troopId === 'canyon-ibex' && unit.coordinate === '-2,-3'));
    sandboxClient.send(JSON.stringify({ type: 'sandbox-place', matchId: sandbox.id, owner: 2, troopId: 'canyon-ibex', coordinate: '-2,-3' }));
    await placed;
    const selected = waitFor(sandboxClient, 'sandbox troop selection', message => message.type === 'state' && message.match.selections?.[1] === 'tiger-queen');
    sandboxClient.send(JSON.stringify({ type: 'select', matchId: sandbox.id, troopId: 'tiger-queen' }));
    await selected;
    const passed = waitFor(sandboxClient, 'sandbox pass action', message => message.type === 'state' && message.match.activePlayer === 2 && message.match.revision === 3);
    sandboxClient.send(JSON.stringify({ type: 'action', matchId: sandbox.id, action: { type: 'pass' } }));
    await passed;

    const bombardierPlaced = waitFor(sandboxClient, 'sandbox bombardier placement', message => message.type === 'state' && message.match.units.some(unit => unit.owner === 2 && unit.troopId === 'bombardier-beetle' && unit.coordinate === '-1,-1'));
    sandboxClient.send(JSON.stringify({ type: 'sandbox-place', matchId: sandbox.id, owner: 2, troopId: 'bombardier-beetle', coordinate: '-1,-1' }));
    await bombardierPlaced;
    const bombThrown = waitFor(sandboxClient, 'sandbox bomb placement', message => message.type === 'state' && message.match.bombs?.some(bomb => bomb.coordinate === '-1,0' && bomb.damage === 2));
    sandboxClient.send(JSON.stringify({ type: 'action', matchId: sandbox.id, action: { type: 'bomb', troopId: 'bombardier-beetle', coordinate: '-1,0' } }));
    await bombThrown;

    const saved = await json(`/api/sandbox/${sandbox.id}/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'alice' }) });
    assert.equal(saved.response.status, 200);
    const loaded = await json('/api/sandbox/load', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'alice' }) });
    assert.equal(loaded.response.status, 200);
    assert.equal(loaded.body.match.sandbox, true);
    assert.deepEqual(loaded.body.match.bombs, [{ owner: 2, sourceTroopId: 'bombardier-beetle', coordinate: '-1,0', damage: 2 }]);
    assert.equal(loaded.body.match.activePlayer, 1);
    assert.notEqual(loaded.body.match.id, sandbox.id);
    const switched = await json(`/api/sandbox/${loaded.body.match.id}/side`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'alice', side: 1 }) });
    assert.equal(switched.body.match.sandboxSide, 1);

    assert.equal((await json('/api/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'alice', deckIndex: 0, format: 8 }) })).body.status, 'waiting');
    const sandboxClosed = new Promise(resolve => sandboxClient.once('close', resolve));
    sandboxClient.close();
    await sandboxClosed;
    assert.equal((await json('/api/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'bob', deckIndex: 0, format: 10 }) })).body.status, 'waiting');
    const matched = (await json('/api/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'charlie', deckIndex: 0, format: 8 }) })).body;
    assert.equal(matched.status, 'matched');
    const aliceStatus = (await json('/api/queue?nickname=alice')).body;
    assert.equal(aliceStatus.matchId, matched.matchId);
    for (const nickname of ['alice', 'charlie']) {
      assert.equal((await json(`/api/matches/${matched.matchId}/deck`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname, deckIndex: 0 }) })).response.status, 200);
      assert.equal((await json(`/api/matches/${matched.matchId}/ready`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname }) })).response.status, 200);
    }

    const alice = new WebSocket(`ws://127.0.0.1:${port}/ws`); const charlie = new WebSocket(`ws://127.0.0.1:${port}/ws`); const mallory = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await Promise.all([alice, charlie, mallory].map(socket => new Promise(resolve => socket.on('open', resolve))));
    const denied = waitFor(mallory, 'unauthorized-join error', message => message.type === 'error'); mallory.send(JSON.stringify({ type: 'join', matchId: matched.matchId, nickname: 'mallory' })); await denied;
    const initialAlicePromise = waitFor(alice, 'Alice’s initial state', message => message.type === 'state'); alice.send(JSON.stringify({ type: 'join', matchId: matched.matchId, nickname: 'alice' })); const initialAlice = await initialAlicePromise;
    const initialCharliePromise = waitFor(charlie, 'Charlie’s initial state', message => message.type === 'state'); charlie.send(JSON.stringify({ type: 'join', matchId: matched.matchId, nickname: 'charlie' })); const initialCharlie = await initialCharliePromise;
    assert.deepEqual(initialAlice.match, initialCharlie.match);
    assert.equal(initialAlice.match.sandbox, false);
    // After both players have opened the board, beginning a fresh queue must
    // not return this old match assignment.
    assert.equal((await json('/api/queue?nickname=alice')).body.status, 'idle');
    const starterSocket = initialAlice.match.players[1] === 'alice' ? alice : charlie;
    const responderSocket = starterSocket === alice ? charlie : alice;
    const stateAlice = waitFor(alice, 'Alice’s revision 1 state', message => message.type === 'state' && message.match.revision === 1); const stateCharlie = waitFor(charlie, 'Charlie’s revision 1 state', message => message.type === 'state' && message.match.revision === 1);
    starterSocket.send(JSON.stringify({ type: 'action', matchId: matched.matchId, action: { type: 'deploy', troopId: 'tiger-queen', coordinate: '1,2' } }));
    const [afterAlice, afterCharlie] = await Promise.all([stateAlice, stateCharlie]);
    assert.deepEqual(afterAlice.match, afterCharlie.match);

    // The first player has just ended their turn and cannot act again yet.
    const outOfTurn = waitFor(starterSocket, 'out-of-turn error', message => message.type === 'error'); starterSocket.send(JSON.stringify({ type: 'action', matchId: matched.matchId, action: { type: 'deploy', troopId: 'ember-salamander', coordinate: '0,1' } })); await outOfTurn;

    // Both decks contain Tiger Queen. The server must keep the two deployed cards distinct.
    const secondAlice = waitFor(alice, 'Alice’s revision 2 state', message => message.type === 'state' && message.match.revision === 2); const secondCharlie = waitFor(charlie, 'Charlie’s revision 2 state', message => message.type === 'state' && message.match.revision === 2);
    responderSocket.send(JSON.stringify({ type: 'action', matchId: matched.matchId, action: { type: 'deploy', troopId: 'tiger-queen', coordinate: '-1,-2' } }));
    const [afterSecondAlice, afterSecondCharlie] = await Promise.all([secondAlice, secondCharlie]);
    assert.deepEqual(afterSecondAlice.match, afterSecondCharlie.match);
    assert.deepEqual(afterSecondAlice.match.units.map(unit => unit.id).sort(), ['1:tiger-queen', '2:tiger-queen']);

    // An invalid active-player action returns only an error and broadcasts no new state.
    const noAliceChange = noStateChange(alice); const noCharlieChange = noStateChange(charlie);
    const invalid = waitFor(starterSocket, 'invalid-action error', message => message.type === 'error'); starterSocket.send(JSON.stringify({ type: 'action', matchId: matched.matchId, action: { type: 'deploy', troopId: 'ember-salamander', coordinate: '0,0' } })); await invalid;
    await Promise.all([noAliceChange, noCharlieChange]);

    // A fresh socket receives the complete current snapshot after reconnecting.
    const closed = new Promise(resolve => alice.once('close', resolve)); alice.close(); await closed;
    const aliceReconnected = new WebSocket(`ws://127.0.0.1:${port}/ws`); await new Promise(resolve => aliceReconnected.on('open', resolve));
    const reconnectedState = waitFor(aliceReconnected, 'Alice’s reconnected state', message => message.type === 'state'); aliceReconnected.send(JSON.stringify({ type: 'join', matchId: matched.matchId, nickname: 'alice' }));
    assert.deepEqual((await reconnectedState).match, afterSecondAlice.match);
    const reconnectedClosed = new Promise(resolve => aliceReconnected.once('close', resolve));
    aliceReconnected.close(); await reconnectedClosed;
    // Closing an unfinished match must still leave a self-contained board and
    // action log for later diagnosis.
    await new Promise(resolve => setTimeout(resolve, 50));
    const logFiles = await readdir(join(dataDir, 'match-logs'));
    assert.equal(logFiles.length, 1);
    const log = JSON.parse(await readFile(join(dataDir, 'match-logs', logFiles[0]), 'utf8'));
    assert.equal(log.reason, 'connection-closed');
    assert.equal(log.finalState.revision, 2);
    assert.equal(log.snapshots.some(snapshot => snapshot.kind === 'action'), true);
    alice.close(); charlie.close(); mallory.close();
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});
