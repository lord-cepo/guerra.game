import type { ServerMatchState } from './protocol.js';

interface MatchConnectionOptions {
  nickname: () => string | undefined;
  activeMatchId: () => string | undefined;
  currentMatch: () => ServerMatchState | undefined;
  onStatus: (status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected') => void;
  onError: (message: string) => void;
  onState: (match: ServerMatchState) => void;
}

export interface MatchConnection {
  connect(matchId: string, reconnecting?: boolean): void;
  close(): void;
  send(message: object): boolean;
}

export function createMatchConnection(options: MatchConnectionOptions): MatchConnection {
  let socket: WebSocket | undefined;
  let reconnectTimer: number | undefined;

  function close(): void {
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    const previous = socket; socket = undefined; previous?.close();
  }

  function send(message: object): boolean {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message)); return true;
  }

  function connect(matchId: string, reconnecting = false): void {
    const nickname = options.nickname(); if (!nickname) return;
    close(); options.onStatus(reconnecting ? 'reconnecting' : 'connecting');
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const next = new WebSocket(`${scheme}://${window.location.host}/ws`); socket = next;
    next.addEventListener('open', () => { next.send(JSON.stringify({ type: 'join', matchId, nickname })); });
    next.addEventListener('message', event => {
      const message = JSON.parse(String(event.data)) as { type?: string; match?: ServerMatchState; message?: string };
      if (message.type === 'error') { options.onError(message.message ?? 'The server rejected that action.'); return; }
      if (message.type !== 'state' || !message.match || !options.nickname()) return;
      options.onStatus('connected'); options.onState(message.match);
    });
    next.addEventListener('close', () => {
      if (socket !== next || options.activeMatchId() !== matchId || options.currentMatch()?.winner) return;
      socket = undefined; options.onStatus('reconnecting'); reconnectTimer = window.setTimeout(() => connect(matchId, true), 1500);
    });
  }

  return { connect, close, send };
}
