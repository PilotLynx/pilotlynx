import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import { appendConversation, getRecentConversation } from '../../../src/lib/relay/history.js';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../../src/lib/config.js';
import { resetRelayConfigCache } from '../../../src/lib/relay/config.js';

describe('relay history', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pilotlynx-relay-hist-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'pilotlynx.yaml'), stringifyYaml({ version: 1, name: 'test' }));
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetRelayConfigCache();
  });

  afterEach(() => {
    process.env.PILOTLYNX_ROOT = origEnv;
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    resetRelayConfigCache();
  });

  it('returns empty array for non-existent chat', () => {
    const result = getRecentConversation('telegram:999');
    expect(result).toEqual([]);
  });

  it('appends and retrieves conversation entries', async () => {
    const chatId = 'telegram:123';
    await appendConversation(chatId, {
      role: 'user',
      content: 'Hello',
      timestamp: '2025-01-01T00:00:00Z',
    });
    await appendConversation(chatId, {
      role: 'assistant',
      content: 'Hi there!',
      timestamp: '2025-01-01T00:00:01Z',
    });

    const result = getRecentConversation(chatId);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toBe('Hello');
    expect(result[1].role).toBe('assistant');
    expect(result[1].content).toBe('Hi there!');
  });

  it('respects the N limit', async () => {
    const chatId = 'telegram:456';
    for (let i = 0; i < 5; i++) {
      await appendConversation(chatId, {
        role: 'user',
        content: `Message ${i}`,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
      });
    }

    const result = getRecentConversation(chatId, 3);
    expect(result).toHaveLength(3);
    expect(result[0].content).toBe('Message 2');
    expect(result[2].content).toBe('Message 4');
  });

  it('sanitizes chat IDs for filenames', async () => {
    // Chat ID with special characters should not cause filesystem errors
    const chatId = 'webhook:https://example.com/hook';
    await appendConversation(chatId, {
      role: 'user',
      content: 'test',
      timestamp: '2025-01-01T00:00:00Z',
    });

    const result = getRecentConversation(chatId);
    expect(result).toHaveLength(1);
  });
});
