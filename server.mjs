import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import { troopSeeds } from './dist/game/cards.js';
import { cleanNickname, readJsonBody, sendJson, serveStatic } from './server/http-utils.mjs';
import { MatchStore } from './server/match-store.mjs';
import { Persistence } from './server/persistence.mjs';
import { UserStore } from './server/user-store.mjs';

const root = resolve(process.cwd());
const port = Number(process.env.PORT ?? 3000);
const dataDirectory = resolve(process.env.DATA_DIR ?? resolve(root, 'data'));
const playgroundEnabled = process.argv.includes('--playground')
  || ['1', 'true', 'yes'].includes(String(process.env.ENABLE_PLAYGROUND ?? '').toLowerCase());
const cardsById = new Map(troopSeeds.map(card => [card.id, card]));
const knownCardIds = new Set(cardsById.keys());
const matchStore = new MatchStore(cardsById);
const userStore = new UserStore(dataDirectory);
const waitingPlayers = new Map();
const queuedMatches = new Map();
const persistence = new Persistence(dataDirectory, matchStore, waitingPlayers, queuedMatches);

function sandboxState(match) {
  return {
    format: match.format,
    activePlayer: match.activePlayer,
    winner: match.winner,
    revision: match.revision,
    decks: match.decks,
    units: match.units.map(({ currentHealth: _currentHealth, combat: _combat, ...unit }) => unit),
    effects: match.effects,
    bashes: match.bashes,
    lastActingTroopId: match.lastActingTroopId,
    defeatedTroopIds: match.defeatedTroopIds,
    events: match.events
  };
}

function validSandboxState(state) {
  if (!state || typeof state !== 'object' || (state.format !== 8 && state.format !== 10)) return false;
  if (!state.decks || !Array.isArray(state.decks[1]) || !Array.isArray(state.decks[2])) return false;
  // Older saved sandboxes contain format-sized decks; new sandboxes expose
  // the full catalogue on both sides.
  const validDeck = deck => deck.length > 0 && new Set(deck).size === deck.length && deck.every(card => typeof card === 'string' && knownCardIds.has(card));
  return validDeck(state.decks[1]) && validDeck(state.decks[2]);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  try {
    if (request.method === 'GET' && url.pathname === '/api/config') {
      return sendJson(response, 200, { playgroundEnabled });
    }

    if (request.method === 'POST' && url.pathname === '/api/login') {
      const nickname = cleanNickname((await readJsonBody(request)).nickname);
      if (!nickname) return sendJson(response, 400, { error: 'Nickname must use 2–24 letters, numbers, _ or -.' });
      const users = await userStore.read();
      userStore.record(users, nickname);
      await userStore.write(users);
      return sendJson(response, 200, { nickname });
    }

    if (request.method === 'GET' && url.pathname === '/api/decks') {
      const nickname = cleanNickname(url.searchParams.get('nickname'));
      if (!nickname) return sendJson(response, 400, { error: 'A valid nickname is required.' });
      const users = await userStore.read();
      return sendJson(response, 200, { decks: userStore.record(users, nickname).decks });
    }

    if (request.method === 'POST' && url.pathname === '/api/matches') {
      const { nickname: rawNickname, opponentNickname: rawOpponent, deckIndex = 0, opponentDeckIndex = 0, format = 10 } = await readJsonBody(request);
      const nickname = cleanNickname(rawNickname);
      const opponentNickname = cleanNickname(rawOpponent);
      if (!nickname || !opponentNickname || nickname === opponentNickname || !Number.isInteger(deckIndex) || !Number.isInteger(opponentDeckIndex) || (format !== 8 && format !== 10)) {
        return sendJson(response, 400, { error: 'Invalid match request.' });
      }
      matchStore.removeSandboxFor(nickname);
      matchStore.removeSandboxFor(opponentNickname);
      const users = await userStore.read();
      const playerOne = userStore.record(users, nickname);
      const playerTwo = users[opponentNickname];
      if (!playerTwo) return sendJson(response, 404, { error: 'Opponent nickname not found.' });
      const deckOne = playerOne.decks[format][deckIndex];
      const deckTwo = userStore.record(users, opponentNickname).decks[format][opponentDeckIndex];
      if (!Array.isArray(deckOne) || !Array.isArray(deckTwo) || deckOne.length !== format || deckTwo.length !== format) {
        return sendJson(response, 400, { error: `Both players need a completed ${format}-card deck.` });
      }
      return sendJson(response, 201, { match: matchStore.createMatch(nickname, opponentNickname, deckOne, deckTwo, format) });
    }

    if (request.method === 'POST' && url.pathname === '/api/queue') {
      const { nickname: rawNickname, format = 10, restart = false } = await readJsonBody(request);
      const nickname = cleanNickname(rawNickname);
      if (!nickname || (format !== 8 && format !== 10)) return sendJson(response, 400, { error: 'Invalid queue request.' });
      // Starting multiplayer leaves only the transient sandbox match. Its
      // explicit save file remains available from the Playground menu.
      matchStore.removeSandboxFor(nickname);
      // A deliberate new Play attempt must never reopen a match found during
      // an earlier browser session. Subsequent polling omits this flag and
      // therefore follows the newly assigned match normally.
      if (restart) queuedMatches.delete(nickname);
      if (queuedMatches.has(nickname)) return sendJson(response, 200, { status: 'matched', matchId: queuedMatches.get(nickname) });
      const waitingPlayer = waitingPlayers.get(format);
      if (!waitingPlayer) {
        waitingPlayers.set(format, { nickname });
        return sendJson(response, 200, { status: 'waiting' });
      }
      if (waitingPlayer.nickname === nickname) return sendJson(response, 200, { status: 'waiting' });
      const first = waitingPlayer;
      waitingPlayers.delete(format);
      const match = matchStore.createMatch(first.nickname, nickname, [], [], format);
      queuedMatches.set(first.nickname, match.id);
      queuedMatches.set(nickname, match.id);
      return sendJson(response, 200, { status: 'matched', matchId: match.id });
    }

    if (request.method === 'GET' && url.pathname === '/api/queue') {
      const nickname = cleanNickname(url.searchParams.get('nickname'));
      if (!nickname) return sendJson(response, 400, { error: 'A valid nickname is required.' });
      const matchId = queuedMatches.get(nickname);
      return sendJson(response, 200, matchId ? { status: 'matched', matchId } : { status: [...waitingPlayers.values()].some(player => player.nickname === nickname) ? 'waiting' : 'idle' });
    }

    if (request.method === 'GET' && url.pathname === '/api/matches/active') {
      const nickname = cleanNickname(url.searchParams.get('nickname'));
      if (!nickname) return sendJson(response, 400, { error: 'A valid nickname is required.' });
      const match = matchStore.matchForNickname(nickname);
      return sendJson(response, 200, { match: match?.sandbox && !playgroundEnabled ? undefined : match });
    }

    if (!playgroundEnabled && url.pathname.startsWith('/api/sandbox')) {
      return sendJson(response, 404, { error: 'Playground is disabled on this server.' });
    }

    if (request.method === 'POST' && url.pathname === '/api/sandbox') {
      const { nickname: rawNickname, format = 10, deckIndex = 0, opponentDeckIndex = deckIndex } = await readJsonBody(request);
      const nickname = cleanNickname(rawNickname);
      if (!nickname || (format !== 8 && format !== 10) || !Number.isInteger(deckIndex) || !Number.isInteger(opponentDeckIndex) || deckIndex < 0 || deckIndex > 3 || opponentDeckIndex < 0 || opponentDeckIndex > 3) {
        return sendJson(response, 400, { error: 'Invalid playground request.' });
      }
      // A sandbox is a card laboratory, not a format-restricted match: both
      // trays deliberately contain the complete shared catalogue. Blue opens
      // the laboratory so the fixed left/bottom side is active first.
      const catalogue = troopSeeds.map(card => card.id);
      const match = matchStore.createSandbox(nickname, {
        format, decks: { 1: catalogue, 2: catalogue }, activePlayer: 2, units: [], effects: [], bashes: [], lastActingTroopId: {}, defeatedTroopIds: [], revision: 0, events: []
      });
      await persistence.saveRuntime();
      return sendJson(response, 201, { match });
    }

    if (request.method === 'POST' && url.pathname === '/api/sandbox/load') {
      const nickname = cleanNickname((await readJsonBody(request)).nickname);
      if (!nickname) return sendJson(response, 400, { error: 'A valid nickname is required.' });
      const saved = await persistence.readSandbox(nickname);
      if (!saved) return sendJson(response, 404, { error: 'No saved playground exists yet.' });
      if (!validSandboxState(saved?.state)) return sendJson(response, 400, { error: 'The saved playground is invalid.' });
      const match = matchStore.createSandbox(nickname, saved.state);
      await persistence.saveRuntime();
      return sendJson(response, 200, { match, savedAt: saved.savedAt });
    }

    const sandboxSide = url.pathname.match(/^\/api\/sandbox\/([\w-]+)\/side$/);
    const sandboxSave = url.pathname.match(/^\/api\/sandbox\/([\w-]+)\/save$/);
    if (request.method === 'POST' && sandboxSide) {
      const { nickname: rawNickname, side } = await readJsonBody(request);
      const nickname = cleanNickname(rawNickname);
      if (!nickname || (side !== 1 && side !== 2)) return sendJson(response, 400, { error: 'A valid sandbox side is required.' });
      const match = matchStore.setSandboxSide(sandboxSide[1], nickname, side);
      await persistence.saveRuntime();
      broadcast(sandboxSide[1], { type: 'state', match });
      return sendJson(response, 200, { match });
    }
    if (request.method === 'POST' && sandboxSave) {
      const nickname = cleanNickname((await readJsonBody(request)).nickname);
      if (!nickname) return sendJson(response, 400, { error: 'A valid nickname is required.' });
      const match = matchStore.getState(sandboxSave[1]);
      if (!match?.sandbox || !matchStore.playerFor(sandboxSave[1], nickname)) return sendJson(response, 404, { error: 'Playground not found.' });
      const savedAt = await persistence.writeSandbox(nickname, sandboxState(match));
      await persistence.saveRuntime();
      return sendJson(response, 200, { savedAt });
    }

    const stateMatch = url.pathname.match(/^\/api\/matches\/([\w-]+)$/);
    const readyMatch = url.pathname.match(/^\/api\/matches\/([\w-]+)\/ready$/);
    const matchDeck = url.pathname.match(/^\/api\/matches\/([\w-]+)\/deck$/);
    if (request.method === 'POST' && matchDeck) {
      const { nickname: rawNickname, deckIndex } = await readJsonBody(request);
      const nickname = cleanNickname(rawNickname);
      if (!nickname || !Number.isInteger(deckIndex) || deckIndex < 0 || deckIndex > 3) return sendJson(response, 400, { error: 'A valid deck selection is required.' });
      const users = await userStore.read();
      const current = matchStore.getState(matchDeck[1]);
      if (current?.sandbox && !playgroundEnabled) return sendJson(response, 404, { error: 'Match not found.' });
      const deck = current && users[nickname] ? userStore.record(users, nickname).decks[current.format][deckIndex] : undefined;
      const match = matchStore.setDeck(matchDeck[1], nickname, deck, deckIndex);
      await persistence.saveRuntime();
      return sendJson(response, 200, { match });
    }
    if (request.method === 'POST' && readyMatch) {
      const nickname = cleanNickname((await readJsonBody(request)).nickname);
      if (!nickname) return sendJson(response, 400, { error: 'A valid nickname is required.' });
      if (matchStore.getState(readyMatch[1])?.sandbox && !playgroundEnabled) return sendJson(response, 404, { error: 'Match not found.' });
      const match = matchStore.setReady(readyMatch[1], nickname);
      await persistence.saveRuntime();
      return sendJson(response, 200, { match });
    }
    if (request.method === 'GET' && stateMatch) {
      const state = matchStore.getState(stateMatch[1]);
      if (state?.sandbox && !playgroundEnabled) return sendJson(response, 404, { error: 'Match not found.' });
      return state ? sendJson(response, 200, { match: state }) : sendJson(response, 404, { error: 'Match not found.' });
    }

    const deckMatch = url.pathname.match(/^\/api\/decks\/(\d)$/);
    if (request.method === 'PUT' && deckMatch) {
      const deckIndex = Number(deckMatch[1]);
      if (deckIndex < 0 || deckIndex > 3) return sendJson(response, 404, { error: 'Deck not found.' });
      const { nickname: rawNickname, cards, format = 10 } = await readJsonBody(request);
      const nickname = cleanNickname(rawNickname);
      const heroCount = Array.isArray(cards) ? cards.filter(card => cardsById.get(card)?.role === 'hero').length : 0;
      const validCards = (format === 8 || format === 10) && Array.isArray(cards) && cards.length <= format && new Set(cards).size === cards.length
        && cards.every(card => typeof card === 'string' && knownCardIds.has(card))
        && heroCount <= 1 && (cards.length < format || heroCount === 1);
      if (!nickname || !validCards) return sendJson(response, 400, { error: 'Invalid deck data.' });
      const users = await userStore.read();
      userStore.record(users, nickname).decks[format][deckIndex] = cards;
      await userStore.write(users);
      return sendJson(response, 200, { deck: cards });
    }
  } catch (error) {
    return sendJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid request.' });
  }

  if (request.url === '/api/health') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // API callers should never receive the static-file "Not found" response:
  // clients can then reliably display the JSON error instead of a parse error.
  if (url.pathname.startsWith('/api/')) return sendJson(response, 404, { error: 'API endpoint not found.' });
  await serveStatic(root, request, response);
});

const webSocketServer = new WebSocketServer({ noServer: true });
const socketsByMatch = new Map();

function broadcast(matchId, payload) {
  for (const socket of socketsByMatch.get(matchId) ?? []) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
  }
}

webSocketServer.on('connection', socket => {
  socket.on('message', rawMessage => {
    try {
      const message = JSON.parse(rawMessage.toString());
      if (message.type === 'join') {
        if (matchStore.getState(message.matchId)?.sandbox && !playgroundEnabled) throw new Error('Playground is disabled on this server.');
        const player = matchStore.playerFor(message.matchId, message.nickname);
        if (!player) throw new Error('You cannot join this match.');
        socket.matchId = message.matchId;
        socket.nickname = message.nickname;
        // Once a player has opened the board, this is no longer a queue-only
        // assignment that a later Play click should be allowed to reuse.
        queuedMatches.delete(message.nickname);
        if (!socketsByMatch.has(message.matchId)) socketsByMatch.set(message.matchId, new Set());
        socketsByMatch.get(message.matchId).add(socket);
        socket.send(JSON.stringify({ type: 'state', match: matchStore.getState(message.matchId) }));
        return;
      }
      if (message.type === 'action') {
        if (!socket.matchId || !socket.nickname || socket.matchId !== message.matchId) throw new Error('Join the match first.');
        const state = matchStore.applyAction(message.matchId, socket.nickname, message.action);
        broadcast(message.matchId, { type: 'state', match: state });
        if (state.status === 'finished') persistence.persistMatchLog(message.matchId, 'match-finished');
        return;
      }
      if (message.type === 'select') {
        if (!socket.matchId || !socket.nickname || socket.matchId !== message.matchId) throw new Error('Join the match first.');
        const state = matchStore.setSelection(message.matchId, socket.nickname, message.troopId, message.target);
        broadcast(message.matchId, { type: 'state', match: state });
        return;
      }
      if (message.type === 'sandbox-mode') {
        if (!playgroundEnabled) throw new Error('Playground is disabled on this server.');
        if (!socket.matchId || !socket.nickname || socket.matchId !== message.matchId) throw new Error('Join the match first.');
        const state = matchStore.setSandboxFreePlacement(message.matchId, socket.nickname, message.freePlacement);
        broadcast(message.matchId, { type: 'state', match: state });
        void persistence.saveRuntime();
        return;
      }
      if (message.type === 'sandbox-place') {
        if (!playgroundEnabled) throw new Error('Playground is disabled on this server.');
        if (!socket.matchId || !socket.nickname || socket.matchId !== message.matchId) throw new Error('Join the match first.');
        const state = matchStore.placeSandboxTroop(message.matchId, socket.nickname, message.owner, message.troopId, message.coordinate);
        broadcast(message.matchId, { type: 'state', match: state });
        void persistence.saveRuntime();
        return;
      }
      throw new Error('Unknown message type.');
    } catch (error) {
      socket.send(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'Invalid message.' }));
    }
  });
  socket.on('close', () => {
    if (!socket.matchId) return;
    socketsByMatch.get(socket.matchId)?.delete(socket);
    // This captures unfinished games too, so a disconnected match can be
    // inspected later instead of losing the board state that exposed a bug.
    persistence.persistMatchLog(socket.matchId, 'connection-closed');
  });
});

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') return socket.destroy();
  webSocketServer.handleUpgrade(request, socket, head, webSocket => webSocketServer.emit('connection', webSocket, request));
});

await persistence.loadRuntime();
server.listen(port, () => {
  console.log(`Hex Grid server listening on http://localhost:${port}${playgroundEnabled ? ' (playground enabled)' : ''}`);
});

let shuttingDown = false;
async function shutDown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await Promise.all(matchStore.snapshot().map(([matchId]) => persistence.saveMatchLog(matchId, `server-${signal.toLowerCase()}`)));
    await persistence.saveRuntime();
  } catch (error) {
    console.error('Could not persist active matches during shutdown:', error);
  }
  webSocketServer.clients.forEach(socket => socket.close());
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.once('SIGINT', () => { void shutDown('SIGINT'); });
process.once('SIGTERM', () => { void shutDown('SIGTERM'); });
