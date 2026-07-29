import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, normalize, resolve, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import { troopSeeds } from './game/cards.js';
import { MatchStore } from './server/match-store.mjs';

const root = resolve(process.cwd());
const port = Number(process.env.PORT ?? 3000);
const dataDirectory = resolve(process.env.DATA_DIR ?? resolve(root, 'data'));
const usersFile = resolve(dataDirectory, 'users.json');
const runtimeFile = resolve(dataDirectory, 'runtime.json');
const matchLogDirectory = resolve(dataDirectory, 'match-logs');
const sandboxDirectory = resolve(dataDirectory, 'sandboxes');
const knownCardIds = new Set(troopSeeds.map(card => card.id));
const matchStore = new MatchStore(new Map(troopSeeds.map(card => [card.id, card])));
const waitingPlayers = new Map();
const queuedMatches = new Map();

async function loadRuntime() {
  try {
    const runtime = JSON.parse(await readFile(runtimeFile, 'utf8'));
    matchStore.restore(runtime.matches);
    for (const [format, player] of runtime.waitingPlayers ?? []) waitingPlayers.set(Number(format), player);
    for (const [nickname, matchId] of runtime.queuedMatches ?? []) queuedMatches.set(nickname, matchId);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function saveRuntime() {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(runtimeFile, JSON.stringify({ matches: matchStore.snapshot(), waitingPlayers: [...waitingPlayers], queuedMatches: [...queuedMatches] }, null, 2), 'utf8');
}

/** Persist a self-contained diagnostic trail for a match and retain the ten
 * most recently created logs. A later disconnect simply refreshes that
 * match's same file with its newest board state. */
async function saveMatchLog(matchId, reason) {
  const log = matchStore.diagnosticLog(matchId);
  if (!log) return;
  await mkdir(matchLogDirectory, { recursive: true });
  const created = log.createdAt.replace(/[:.]/g, '-');
  const filename = `${created}_${matchId}.json`;
  const payload = {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    reason,
    ...log
  };
  await writeFile(resolve(matchLogDirectory, filename), JSON.stringify(payload, null, 2), 'utf8');
  const files = (await readdir(matchLogDirectory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => entry.name)
    .sort();
  await Promise.all(files.slice(0, Math.max(0, files.length - 10)).map(file => unlink(resolve(matchLogDirectory, file))));
}

function persistMatchLog(matchId, reason) {
  void saveMatchLog(matchId, reason).catch(error => console.error(`Could not save match log ${matchId}:`, error));
}

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function fileForRequest(url) {
  const pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  const relativePath = pathname === '/' ? 'hex-grid.html' : pathname.replace(/^\/+/, '');
  const filename = resolve(root, normalize(relativePath));
  return filename.startsWith(`${root}${sep}`) || filename === root ? filename : undefined;
}

function cleanNickname(value) {
  const nickname = typeof value === 'string' ? value.trim() : '';
  return /^[a-zA-Z0-9_-]{2,24}$/.test(nickname) ? nickname : undefined;
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 10_000) throw new Error('Request body is too large');
  }
  return JSON.parse(body || '{}');
}

async function readUsers() {
  try {
    return JSON.parse(await readFile(usersFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeUsers(users) {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(usersFile, JSON.stringify(users, null, 2), 'utf8');
}

function sandboxFile(nickname) {
  // `cleanNickname` restricts this to a filesystem-safe basename.
  return resolve(sandboxDirectory, `${nickname}.json`);
}

function sandboxState(match) {
  return {
    format: match.format,
    activePlayer: match.activePlayer,
    winner: match.winner,
    revision: match.revision,
    decks: match.decks,
    units: match.units,
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

function userRecord(users, nickname) {
  if (!users[nickname]) users[nickname] = { decks: { 8: [[], [], [], []], 10: [[], [], [], []] } };
  // Migrate the former four shared slots without losing an existing deck.
  if (Array.isArray(users[nickname].decks)) {
    const oldDecks = users[nickname].decks;
    const decks = { 8: [[], [], [], []], 10: [[], [], [], []] };
    oldDecks.slice(0, 4).forEach((deck, index) => {
      if (Array.isArray(deck) && deck.length === 8) decks[8][index] = deck;
      if (Array.isArray(deck) && deck.length === 10) decks[10][index] = deck;
    });
    users[nickname].decks = decks;
  }
  return users[nickname];
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  try {
    if (request.method === 'POST' && url.pathname === '/api/login') {
      const nickname = cleanNickname((await readBody(request)).nickname);
      if (!nickname) return sendJson(response, 400, { error: 'Nickname must use 2–24 letters, numbers, _ or -.' });
      const users = await readUsers();
      userRecord(users, nickname);
      await writeUsers(users);
      return sendJson(response, 200, { nickname });
    }

    if (request.method === 'GET' && url.pathname === '/api/decks') {
      const nickname = cleanNickname(url.searchParams.get('nickname'));
      if (!nickname) return sendJson(response, 400, { error: 'A valid nickname is required.' });
      const users = await readUsers();
      return sendJson(response, 200, { decks: userRecord(users, nickname).decks });
    }

    if (request.method === 'POST' && url.pathname === '/api/matches') {
      const { nickname: rawNickname, opponentNickname: rawOpponent, deckIndex = 0, opponentDeckIndex = 0, format = 10 } = await readBody(request);
      const nickname = cleanNickname(rawNickname);
      const opponentNickname = cleanNickname(rawOpponent);
      if (!nickname || !opponentNickname || nickname === opponentNickname || !Number.isInteger(deckIndex) || !Number.isInteger(opponentDeckIndex) || (format !== 8 && format !== 10)) {
        return sendJson(response, 400, { error: 'Invalid match request.' });
      }
      matchStore.removeSandboxFor(nickname);
      matchStore.removeSandboxFor(opponentNickname);
      const users = await readUsers();
      const playerOne = userRecord(users, nickname);
      const playerTwo = users[opponentNickname];
      if (!playerTwo) return sendJson(response, 404, { error: 'Opponent nickname not found.' });
      const deckOne = playerOne.decks[format][deckIndex];
      const deckTwo = userRecord(users, opponentNickname).decks[format][opponentDeckIndex];
      if (!Array.isArray(deckOne) || !Array.isArray(deckTwo) || deckOne.length !== format || deckTwo.length !== format) {
        return sendJson(response, 400, { error: `Both players need a completed ${format}-card deck.` });
      }
      return sendJson(response, 201, { match: matchStore.createMatch(nickname, opponentNickname, deckOne, deckTwo, format) });
    }

    if (request.method === 'POST' && url.pathname === '/api/queue') {
      const { nickname: rawNickname, format = 10, restart = false } = await readBody(request);
      const nickname = cleanNickname(rawNickname);
      if (!nickname || (format !== 8 && format !== 10)) return sendJson(response, 400, { error: 'Invalid queue request.' });
      // Starting multiplayer leaves only the transient sandbox match. Its
      // explicit save file remains available from the Sandbox menu.
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
      return sendJson(response, 200, { match: matchStore.matchForNickname(nickname) });
    }

    if (request.method === 'POST' && url.pathname === '/api/sandbox') {
      const { nickname: rawNickname, format = 10, deckIndex = 0, opponentDeckIndex = deckIndex } = await readBody(request);
      const nickname = cleanNickname(rawNickname);
      if (!nickname || (format !== 8 && format !== 10) || !Number.isInteger(deckIndex) || !Number.isInteger(opponentDeckIndex) || deckIndex < 0 || deckIndex > 3 || opponentDeckIndex < 0 || opponentDeckIndex > 3) {
        return sendJson(response, 400, { error: 'Invalid sandbox request.' });
      }
      // A sandbox is a card laboratory, not a format-restricted match: both
      // trays deliberately contain the complete shared catalogue.
      const catalogue = troopSeeds.map(card => card.id);
      const match = matchStore.createSandbox(nickname, {
        format, decks: { 1: catalogue, 2: catalogue }, activePlayer: 1, units: [], effects: [], bashes: [], lastActingTroopId: {}, defeatedTroopIds: [], revision: 0, events: []
      });
      await saveRuntime();
      return sendJson(response, 201, { match });
    }

    if (request.method === 'POST' && url.pathname === '/api/sandbox/load') {
      const nickname = cleanNickname((await readBody(request)).nickname);
      if (!nickname) return sendJson(response, 400, { error: 'A valid nickname is required.' });
      let saved;
      try { saved = JSON.parse(await readFile(sandboxFile(nickname), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return sendJson(response, 404, { error: 'No saved sandbox exists yet.' }); throw error; }
      if (!validSandboxState(saved?.state)) return sendJson(response, 400, { error: 'The saved sandbox is invalid.' });
      const match = matchStore.createSandbox(nickname, saved.state);
      await saveRuntime();
      return sendJson(response, 200, { match, savedAt: saved.savedAt });
    }

    const sandboxSide = url.pathname.match(/^\/api\/sandbox\/([\w-]+)\/side$/);
    const sandboxSave = url.pathname.match(/^\/api\/sandbox\/([\w-]+)\/save$/);
    if (request.method === 'POST' && sandboxSide) {
      const { nickname: rawNickname, side } = await readBody(request);
      const nickname = cleanNickname(rawNickname);
      if (!nickname || (side !== 1 && side !== 2)) return sendJson(response, 400, { error: 'A valid sandbox side is required.' });
      const match = matchStore.setSandboxSide(sandboxSide[1], nickname, side);
      await saveRuntime();
      broadcast(sandboxSide[1], { type: 'state', match });
      return sendJson(response, 200, { match });
    }
    if (request.method === 'POST' && sandboxSave) {
      const nickname = cleanNickname((await readBody(request)).nickname);
      if (!nickname) return sendJson(response, 400, { error: 'A valid nickname is required.' });
      const match = matchStore.getState(sandboxSave[1]);
      if (!match?.sandbox || !matchStore.playerFor(sandboxSave[1], nickname)) return sendJson(response, 404, { error: 'Sandbox not found.' });
      await mkdir(sandboxDirectory, { recursive: true });
      await writeFile(sandboxFile(nickname), JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), state: sandboxState(match) }, null, 2), 'utf8');
      await saveRuntime();
      return sendJson(response, 200, { savedAt: new Date().toISOString() });
    }

    const stateMatch = url.pathname.match(/^\/api\/matches\/([\w-]+)$/);
    const readyMatch = url.pathname.match(/^\/api\/matches\/([\w-]+)\/ready$/);
    const matchDeck = url.pathname.match(/^\/api\/matches\/([\w-]+)\/deck$/);
    if (request.method === 'POST' && matchDeck) {
      const { nickname: rawNickname, deckIndex } = await readBody(request);
      const nickname = cleanNickname(rawNickname);
      if (!nickname || !Number.isInteger(deckIndex) || deckIndex < 0 || deckIndex > 3) return sendJson(response, 400, { error: 'A valid deck selection is required.' });
      const users = await readUsers();
      const current = matchStore.getState(matchDeck[1]);
      const deck = current && users[nickname] ? userRecord(users, nickname).decks[current.format][deckIndex] : undefined;
      const match = matchStore.setDeck(matchDeck[1], nickname, deck, deckIndex);
      await saveRuntime();
      return sendJson(response, 200, { match });
    }
    if (request.method === 'POST' && readyMatch) {
      const nickname = cleanNickname((await readBody(request)).nickname);
      if (!nickname) return sendJson(response, 400, { error: 'A valid nickname is required.' });
      const match = matchStore.setReady(readyMatch[1], nickname);
      await saveRuntime();
      return sendJson(response, 200, { match });
    }
    if (request.method === 'GET' && stateMatch) {
      const state = matchStore.getState(stateMatch[1]);
      return state ? sendJson(response, 200, { match: state }) : sendJson(response, 404, { error: 'Match not found.' });
    }

    const deckMatch = url.pathname.match(/^\/api\/decks\/(\d)$/);
    if (request.method === 'PUT' && deckMatch) {
      const deckIndex = Number(deckMatch[1]);
      if (deckIndex < 0 || deckIndex > 3) return sendJson(response, 404, { error: 'Deck not found.' });
      const { nickname: rawNickname, cards, format = 10 } = await readBody(request);
      const nickname = cleanNickname(rawNickname);
      const validCards = (format === 8 || format === 10) && Array.isArray(cards) && cards.length <= format && new Set(cards).size === cards.length
        && cards.every(card => typeof card === 'string' && knownCardIds.has(card))
        && cards.filter(card => troopSeeds.find(seed => seed.id === card)?.role === 'hero').length === 1;
      if (!nickname || !validCards) return sendJson(response, 400, { error: 'Invalid deck data.' });
      const users = await readUsers();
      userRecord(users, nickname).decks[format][deckIndex] = cards;
      await writeUsers(users);
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

  const filename = fileForRequest(request.url ?? '/');
  if (!filename) {
    response.writeHead(403).end();
    return;
  }

  try {
    await access(filename);
    const info = await stat(filename);
    if (!info.isFile()) throw new Error('Not a file');
    // This is a small development server. Avoid pinning an old client bundle
    // in a browser while server-side game state has already been updated.
    response.writeHead(200, {
      'content-type': mimeTypes[extname(filename)] ?? 'application/octet-stream',
      'cache-control': 'no-store'
    });
    createReadStream(filename).pipe(response);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
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
        if (state.status === 'finished') persistMatchLog(message.matchId, 'match-finished');
        return;
      }
      if (message.type === 'select') {
        if (!socket.matchId || !socket.nickname || socket.matchId !== message.matchId) throw new Error('Join the match first.');
        const state = matchStore.setSelection(message.matchId, socket.nickname, message.troopId, message.target);
        broadcast(message.matchId, { type: 'state', match: state });
        return;
      }
      if (message.type === 'sandbox-mode') {
        if (!socket.matchId || !socket.nickname || socket.matchId !== message.matchId) throw new Error('Join the match first.');
        const state = matchStore.setSandboxFreePlacement(message.matchId, socket.nickname, message.freePlacement);
        broadcast(message.matchId, { type: 'state', match: state });
        void saveRuntime();
        return;
      }
      if (message.type === 'sandbox-place') {
        if (!socket.matchId || !socket.nickname || socket.matchId !== message.matchId) throw new Error('Join the match first.');
        const state = matchStore.placeSandboxTroop(message.matchId, socket.nickname, message.owner, message.troopId, message.coordinate);
        broadcast(message.matchId, { type: 'state', match: state });
        void saveRuntime();
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
    persistMatchLog(socket.matchId, 'connection-closed');
  });
});

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') return socket.destroy();
  webSocketServer.handleUpgrade(request, socket, head, webSocket => webSocketServer.emit('connection', webSocket, request));
});

await loadRuntime();
server.listen(port, () => {
  console.log(`Hex Grid server listening on http://localhost:${port}`);
});

let shuttingDown = false;
async function shutDown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await Promise.all(matchStore.snapshot().map(([matchId]) => saveMatchLog(matchId, `server-${signal.toLowerCase()}`)));
    await saveRuntime();
  } catch (error) {
    console.error('Could not persist active matches during shutdown:', error);
  }
  webSocketServer.clients.forEach(socket => socket.close());
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.once('SIGINT', () => { void shutDown('SIGINT'); });
process.once('SIGTERM', () => { void shutDown('SIGTERM'); });
