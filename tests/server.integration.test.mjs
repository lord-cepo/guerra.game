import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';

const root = process.cwd();
const port = 3200 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
const deck8 = ['p1-hero', 'p1-1', 'p1-2', 'p1-3', 'p1-4', 'p1-5', 'p1-6', 'p1-7'];
const deck10 = [...deck8, 'p2-hero', 'p2-1'];
const json = async (path, options) => { const response = await fetch(`${base}${path}`, options); return { response, body: await response.json() }; };
const waitFor = (socket, predicate) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Timed out waiting for WebSocket message')), 3000);
  socket.on('message', raw => { const message = JSON.parse(raw.toString()); if (predicate(message)) { clearTimeout(timeout); resolve(message); } });
});
const noStateChange = socket => new Promise((resolve, reject) => {
  const listener = raw => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'state') { clearTimeout(timeout); socket.off('message', listener); reject(new Error('Unexpected state broadcast.')); }
  };
  const timeout = setTimeout(() => { socket.off('message', listener); resolve(); }, 180);
  socket.on('message', listener);
});

test('queue and WebSocket match integration', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'hex-grid-test-'));
  const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir } });
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
    for (const nickname of ['alice', 'bob', 'charlie', 'mallory']) await json('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname }) });
    for (const [nickname, cards] of [['alice', deck8], ['bob', deck10], ['charlie', deck8]]) await json('/api/decks/0', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname, cards, format: cards.length }) });

    // A sandbox is an authoritative match operated by one nickname. Its save
    // file is independent of its transient match id, so loading creates a
    // fresh sandbox with the exact board state.
    const sandbox = (await json('/api/sandbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'alice', format: 8 }) })).body.match;
    assert.equal(sandbox.sandbox, true);
    assert.equal(sandbox.sandboxSide, 1);
    const saved = await json(`/api/sandbox/${sandbox.id}/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'alice' }) });
    assert.equal(saved.response.status, 200);
    const loaded = await json('/api/sandbox/load', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'alice' }) });
    assert.equal(loaded.response.status, 200);
    assert.equal(loaded.body.match.sandbox, true);
    assert.notEqual(loaded.body.match.id, sandbox.id);
    const switched = await json(`/api/sandbox/${loaded.body.match.id}/side`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'alice', side: 2 }) });
    assert.equal(switched.body.match.sandboxSide, 2);

    assert.equal((await json('/api/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'alice', deckIndex: 0, format: 8 }) })).body.status, 'waiting');
    assert.equal((await json('/api/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'bob', deckIndex: 0, format: 10 }) })).body.status, 'waiting');
    const matched = (await json('/api/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'charlie', deckIndex: 0, format: 8 }) })).body;
    assert.equal(matched.status, 'matched');
    const aliceStatus = (await json('/api/queue?nickname=alice')).body;
    assert.equal(aliceStatus.matchId, matched.matchId);
    await json(`/api/matches/${matched.matchId}/deck`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'alice', deckIndex: 0 }) });
    await json(`/api/matches/${matched.matchId}/deck`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'charlie', deckIndex: 0 }) });
    await json(`/api/matches/${matched.matchId}/ready`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'alice' }) });
    await json(`/api/matches/${matched.matchId}/ready`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'charlie' }) });

    const alice = new WebSocket(`ws://127.0.0.1:${port}/ws`); const charlie = new WebSocket(`ws://127.0.0.1:${port}/ws`); const mallory = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await Promise.all([alice, charlie, mallory].map(socket => new Promise(resolve => socket.on('open', resolve))));
    const denied = waitFor(mallory, message => message.type === 'error'); mallory.send(JSON.stringify({ type: 'join', matchId: matched.matchId, nickname: 'mallory' })); await denied;
    const initialAlicePromise = waitFor(alice, message => message.type === 'state'); alice.send(JSON.stringify({ type: 'join', matchId: matched.matchId, nickname: 'alice' })); const initialAlice = await initialAlicePromise;
    const initialCharliePromise = waitFor(charlie, message => message.type === 'state'); charlie.send(JSON.stringify({ type: 'join', matchId: matched.matchId, nickname: 'charlie' })); const initialCharlie = await initialCharliePromise;
    assert.deepEqual(initialAlice.match, initialCharlie.match);
    assert.equal(initialAlice.match.sandbox, false);
    // After both players have opened the board, beginning a fresh queue must
    // not return this old match assignment.
    assert.equal((await json('/api/queue?nickname=alice')).body.status, 'idle');
    const starterSocket = initialAlice.match.players[1] === 'alice' ? alice : charlie;
    const responderSocket = starterSocket === alice ? charlie : alice;
    const stateAlice = waitFor(alice, message => message.type === 'state' && message.match.revision === 1); const stateCharlie = waitFor(charlie, message => message.type === 'state' && message.match.revision === 1);
    starterSocket.send(JSON.stringify({ type: 'action', matchId: matched.matchId, action: { type: 'deploy', troopId: 'p1-hero', coordinate: '1,2' } }));
    const [afterAlice, afterCharlie] = await Promise.all([stateAlice, stateCharlie]);
    assert.deepEqual(afterAlice.match, afterCharlie.match);

    // The first player has just ended their turn and cannot act again yet.
    const outOfTurn = waitFor(starterSocket, message => message.type === 'error'); starterSocket.send(JSON.stringify({ type: 'action', matchId: matched.matchId, action: { type: 'deploy', troopId: 'p1-1', coordinate: '0,1' } })); await outOfTurn;

    // Both decks contain p1-hero. The server must keep the two deployed cards distinct.
    const secondAlice = waitFor(alice, message => message.type === 'state' && message.match.revision === 2); const secondCharlie = waitFor(charlie, message => message.type === 'state' && message.match.revision === 2);
    responderSocket.send(JSON.stringify({ type: 'action', matchId: matched.matchId, action: { type: 'deploy', troopId: 'p1-hero', coordinate: '-1,-2' } }));
    const [afterSecondAlice, afterSecondCharlie] = await Promise.all([secondAlice, secondCharlie]);
    assert.deepEqual(afterSecondAlice.match, afterSecondCharlie.match);
    assert.deepEqual(afterSecondAlice.match.units.map(unit => unit.id).sort(), ['1:p1-hero', '2:p1-hero']);

    // An invalid active-player action returns only an error and broadcasts no new state.
    const noAliceChange = noStateChange(alice); const noCharlieChange = noStateChange(charlie);
    const invalid = waitFor(starterSocket, message => message.type === 'error'); starterSocket.send(JSON.stringify({ type: 'action', matchId: matched.matchId, action: { type: 'deploy', troopId: 'p1-1', coordinate: '0,0' } })); await invalid;
    await Promise.all([noAliceChange, noCharlieChange]);

    // A fresh socket receives the complete current snapshot after reconnecting.
    const closed = new Promise(resolve => alice.once('close', resolve)); alice.close(); await closed;
    const aliceReconnected = new WebSocket(`ws://127.0.0.1:${port}/ws`); await new Promise(resolve => aliceReconnected.on('open', resolve));
    const reconnectedState = waitFor(aliceReconnected, message => message.type === 'state'); aliceReconnected.send(JSON.stringify({ type: 'join', matchId: matched.matchId, nickname: 'alice' }));
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
  } finally { server.kill(); await rm(dataDir, { recursive: true, force: true }); }
});
