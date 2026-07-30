import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export class Persistence {
  constructor(dataDirectory, matchStore, waitingPlayers, queuedMatches) {
    this.dataDirectory = dataDirectory;
    this.matchStore = matchStore;
    this.waitingPlayers = waitingPlayers;
    this.queuedMatches = queuedMatches;
    this.runtimeFile = resolve(dataDirectory, 'runtime.json');
    this.matchLogDirectory = resolve(dataDirectory, 'match-logs');
    this.sandboxDirectory = resolve(dataDirectory, 'sandboxes');
  }

  async loadRuntime() {
    try {
      const runtime = JSON.parse(await readFile(this.runtimeFile, 'utf8'));
      this.matchStore.restore(runtime.matches);
      for (const [format, player] of runtime.waitingPlayers ?? []) this.waitingPlayers.set(Number(format), player);
      for (const [nickname, matchId] of runtime.queuedMatches ?? []) this.queuedMatches.set(nickname, matchId);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async saveRuntime() {
    await mkdir(this.dataDirectory, { recursive: true });
    const runtime = {
      matches: this.matchStore.snapshot(),
      waitingPlayers: [...this.waitingPlayers],
      queuedMatches: [...this.queuedMatches]
    };
    await writeFile(this.runtimeFile, JSON.stringify(runtime, null, 2), 'utf8');
  }

  /** Persist a self-contained diagnostic trail and retain the ten newest logs. */
  async saveMatchLog(matchId, reason) {
    const log = this.matchStore.diagnosticLog(matchId);
    if (!log) return;
    await mkdir(this.matchLogDirectory, { recursive: true });
    const created = log.createdAt.replace(/[:.]/g, '-');
    const filename = `${created}_${matchId}.json`;
    const payload = { schemaVersion: 1, savedAt: new Date().toISOString(), reason, ...log };
    await writeFile(resolve(this.matchLogDirectory, filename), JSON.stringify(payload, null, 2), 'utf8');
    const files = (await readdir(this.matchLogDirectory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => entry.name)
      .sort();
    const expired = files.slice(0, Math.max(0, files.length - 10));
    await Promise.all(expired.map(file => unlink(resolve(this.matchLogDirectory, file))));
  }

  persistMatchLog(matchId, reason) {
    void this.saveMatchLog(matchId, reason).catch(error => {
      console.error(`Could not save match log ${matchId}:`, error);
    });
  }

  async readSandbox(nickname) {
    try {
      return JSON.parse(await readFile(this.#sandboxFile(nickname), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async writeSandbox(nickname, state) {
    await mkdir(this.sandboxDirectory, { recursive: true });
    const savedAt = new Date().toISOString();
    await writeFile(this.#sandboxFile(nickname), JSON.stringify({ schemaVersion: 1, savedAt, state }, null, 2), 'utf8');
    return savedAt;
  }

  #sandboxFile(nickname) {
    // Nicknames are validated before reaching persistence.
    return resolve(this.sandboxDirectory, `${nickname}.json`);
  }
}
