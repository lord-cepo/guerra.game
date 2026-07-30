import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export class UserStore {
  constructor(dataDirectory) {
    this.dataDirectory = dataDirectory;
    this.usersFile = resolve(dataDirectory, 'users.json');
  }

  async read() {
    try {
      return JSON.parse(await readFile(this.usersFile, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }

  async write(users) {
    await mkdir(this.dataDirectory, { recursive: true });
    await writeFile(this.usersFile, JSON.stringify(users, null, 2), 'utf8');
  }

  /**
   * Return a normalized record, migrating the former four shared deck slots
   * into format-specific slots without losing completed decks.
   */
  record(users, nickname) {
    if (!users[nickname]) users[nickname] = { decks: { 8: [[], [], [], []], 10: [[], [], [], []] } };
    if (Array.isArray(users[nickname].decks)) {
      const previousDecks = users[nickname].decks;
      const decks = { 8: [[], [], [], []], 10: [[], [], [], []] };
      previousDecks.slice(0, 4).forEach((deck, index) => {
        if (Array.isArray(deck) && deck.length === 8) decks[8][index] = deck;
        if (Array.isArray(deck) && deck.length === 10) decks[10][index] = deck;
      });
      users[nickname].decks = decks;
    }
    return users[nickname];
  }
}
