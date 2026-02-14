import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDb } from '../../src/lib/relay/db.js';
import {
  saveBinding,
  removeBinding,
  lookupBinding,
  getBindingsForPlatform,
  getChannelForProject,
  getAllBindings,
} from '../../src/lib/relay/bindings.js';

let db: Database.Database;

beforeEach(() => {
  db = initDb(':memory:');
});

afterEach(() => {
  db.close();
});

describe('saveBinding and lookupBinding', () => {
  it('saves a binding and retrieves the project by channel', () => {
    saveBinding(db, 'slack', 'C123', 'my-project', 'U001');
    const project = lookupBinding(db, 'slack', 'C123');
    expect(project).toBe('my-project');
  });

  it('returns null for non-existent binding', () => {
    const project = lookupBinding(db, 'slack', 'NONEXISTENT');
    expect(project).toBeNull();
  });
});

describe('removeBinding', () => {
  it('returns true when removing an existing binding', () => {
    saveBinding(db, 'slack', 'C123', 'proj', 'U001');
    const removed = removeBinding(db, 'slack', 'C123');
    expect(removed).toBe(true);
    expect(lookupBinding(db, 'slack', 'C123')).toBeNull();
  });

  it('returns false when removing a non-existent binding', () => {
    const removed = removeBinding(db, 'slack', 'C999');
    expect(removed).toBe(false);
  });
});

describe('getBindingsForPlatform', () => {
  it('filters bindings by platform', () => {
    saveBinding(db, 'slack', 'C1', 'proj-a', 'U001');
    saveBinding(db, 'slack', 'C2', 'proj-b', 'U002');
    saveBinding(db, 'telegram', 'T1', 'proj-c', 'U003');

    const slackBindings = getBindingsForPlatform(db, 'slack');
    expect(slackBindings).toHaveLength(2);
    expect(slackBindings.map((b) => b.project).sort()).toEqual(['proj-a', 'proj-b']);

    const telegramBindings = getBindingsForPlatform(db, 'telegram');
    expect(telegramBindings).toHaveLength(1);
    expect(telegramBindings[0].project).toBe('proj-c');
  });

  it('returns empty array for platform with no bindings', () => {
    const bindings = getBindingsForPlatform(db, 'discord');
    expect(bindings).toEqual([]);
  });
});

describe('getChannelForProject', () => {
  it('returns channel ID for a bound project', () => {
    saveBinding(db, 'slack', 'C42', 'my-proj', 'U001');
    const channel = getChannelForProject(db, 'slack', 'my-proj');
    expect(channel).toBe('C42');
  });

  it('returns null when project is not bound on that platform', () => {
    saveBinding(db, 'slack', 'C42', 'my-proj', 'U001');
    const channel = getChannelForProject(db, 'telegram', 'my-proj');
    expect(channel).toBeNull();
  });
});

describe('getAllBindings', () => {
  it('returns bindings across all platforms', () => {
    saveBinding(db, 'slack', 'C1', 'proj-a', 'U001');
    saveBinding(db, 'telegram', 'T1', 'proj-b', 'U002');

    const all = getAllBindings(db);
    expect(all).toHaveLength(2);

    const platforms = all.map((b) => b.platform).sort();
    expect(platforms).toEqual(['slack', 'telegram']);
  });

  it('returns empty array when no bindings exist', () => {
    const all = getAllBindings(db);
    expect(all).toEqual([]);
  });
});

describe('upsert behavior', () => {
  it('overwrites project when saving the same channel twice', () => {
    saveBinding(db, 'slack', 'C1', 'proj-a', 'U001');
    saveBinding(db, 'slack', 'C1', 'proj-b', 'U002');

    const project = lookupBinding(db, 'slack', 'C1');
    expect(project).toBe('proj-b');

    // Should still be just one binding for that channel
    const all = getBindingsForPlatform(db, 'slack');
    expect(all).toHaveLength(1);
    expect(all[0].boundBy).toBe('U002');
  });
});
