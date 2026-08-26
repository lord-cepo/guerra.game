import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

export class Persistence {
  constructor(dataDirectory, matchStore, waitingPlayers, queuedMatches) {
    this.dataDirectory = dataDirectory;
    this.matchStore = matchStore;
    this.waitingPlayers = waitingPlayers;
    this.queuedMatches = queuedMatches;
    this.runtimeFile = resolve(dataDirectory, 'runtime.json');
    this.runtimeBackupFile = resolve(dataDirectory, 'runtime.backup.json');
    this.matchLogDirectory = resolve(dataDirectory, 'match-logs');
    this.sandboxDirectory = resolve(dataDirectory, 'sandboxes');
    // WebSocket close handlers and shutdown can persist the same match at the
    // same time. Serialize log writes so retention cannot unlink a file that
    // another writer is still using.
    this.matchLogQueue = Promise.resolve();
    this.runtimeWriteQueue = Promise.resolve();
  }

  async loadRuntime() {
    const runtime = await this.#readRuntimeWithFallback();
    if (!runtime) return;
    this.matchStore.restore(runtime.matches);
    for (const [format, player] of runtime.waitingPlayers ?? []) this.waitingPlayers.set(Number(format), player);
    for (const [nickname, matchId] of runtime.queuedMatches ?? []) this.queuedMatches.set(nickname, matchId);
  }

  saveRuntime() {
    const payload = JSON.stringify({
      matches: this.matchStore.snapshot(),
      waitingPlayers: [...this.waitingPlayers],
      queuedMatches: [...this.queuedMatches]
    }, null, 2);
    const write = this.runtimeWriteQueue.then(() => this.#writeRuntime(payload));
    this.runtimeWriteQueue = write.catch(() => {});
    return write;
  }

  async #writeRuntime(payload) {
    await mkdir(this.dataDirectory, { recursive: true });
    // A shared temp filename is unsafe when an old server process is still
    // running: one process can rename another process's partially-written
    // temp file into place. Use a private file for every save, then publish
    // only after the complete payload has been written.
    const runtimeTemporaryFile = resolve(
      this.dataDirectory,
      `runtime.json.tmp-${process.pid}-${randomUUID()}`
    );
    try {
      await writeFile(runtimeTemporaryFile, payload, 'utf8');
      try {
        JSON.parse(await readFile(this.runtimeFile, 'utf8'));
        await rename(this.runtimeFile, this.runtimeBackupFile);
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      await rename(runtimeTemporaryFile, this.runtimeFile);
    } finally {
      await unlink(runtimeTemporaryFile).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }

  async #readRuntimeWithFallback() {
    try {
      return JSON.parse(await readFile(this.runtimeFile, 'utf8'));
    } catch (primaryError) {
      if (primaryError.code === 'ENOENT') {
        try { return JSON.parse(await readFile(this.runtimeBackupFile, 'utf8')); }
        catch (backupError) {
          if (backupError.code === 'ENOENT') return undefined;
          throw backupError;
        }
      }
      if (!(primaryError instanceof SyntaxError)) throw primaryError;
      try { return JSON.parse(await readFile(this.runtimeBackupFile, 'utf8')); }
      catch (backupError) {
        if (backupError.code === 'ENOENT') throw primaryError;
        throw new AggregateError([primaryError, backupError], 'Both runtime.json and runtime.backup.json are invalid.');
      }
    }
  }

  /** Persist a self-contained diagnostic trail and retain the ten newest logs. */
  saveMatchLog(matchId, reason) {
    const write = this.matchLogQueue.then(() => this.#writeMatchLog(matchId, reason));
    this.matchLogQueue = write.catch(() => {});
    return write;
  }

  async #writeMatchLog(matchId, reason) {
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
    await Promise.all(expired.map(file => unlink(resolve(this.matchLogDirectory, file)).catch(error => {
      // A stale cleanup entry can disappear after a previous retention pass.
      if (error.code !== 'ENOENT') throw error;
    })));
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
