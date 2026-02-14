import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import Database from 'better-sqlite3';
import { initDb } from '../../src/lib/relay/db.js';
import { parseCommand, isAdmin, handleAdminCommand } from '../../src/lib/relay/admin.js';
import { saveBinding } from '../../src/lib/relay/bindings.js';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../src/lib/config.js';
import { resetPolicyCache } from '../../src/lib/policy.js';
import { resetRegistryCache } from '../../src/lib/registry.js';
import type { RelayConfig } from '../../src/lib/relay/types.js';

let db: Database.Database;
let tmpDir: string;
let configDir: string;

const baseConfig: RelayConfig = {
  version: 1,
  platforms: {
    slack: { enabled: true, mode: 'socket', port: 3210 },
    telegram: { enabled: false, streamMode: 'edit', editIntervalMs: 12000 },
  },
  agent: {
    maxConcurrent: 3,
    defaultTimeoutMs: 300_000,
    maxMemoryMB: 4096,
    requireKernelSandbox: true,
    networkIsolation: true,
    maxTurns: 30,
  },
  context: {
    tokenBudget: 16_000,
    maxMessagesPerThread: 50,
    maxCharsPerMessage: 4000,
    staleThreadDays: 7,
    enableCache: true,
  },
  limits: {
    userRatePerHour: 10,
    projectQueueDepth: 10,
    dailyBudgetPerProject: 10,
    reactionRatePerHour: 20,
    globalConcurrency: 5,
  },
  notifications: {
    scheduleFailures: true,
    improveInsights: true,
    budgetAlerts: true,
    healthScoreThreshold: 50,
  },
  admins: {
    slack: ['U-ADMIN'],
    telegram: ['T-ADMIN'],
  },
};

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'pilotlynx-'));
  configDir = join(tmpDir, CONFIG_DIR_NAME);
  process.env.PILOTLYNX_ROOT = configDir;
  resetConfigCache();
  resetPolicyCache();
  resetRegistryCache();
  mkdirSync(join(configDir, 'shared', 'policies'), { recursive: true });
  mkdirSync(join(configDir, 'shared', 'insights'), { recursive: true });
  writeFileSync(join(configDir, 'projects.yaml'), stringifyYaml({ version: 1, projects: {} }));
  db = initDb(':memory:');
});

afterEach(() => {
  db.close();
  delete process.env.PILOTLYNX_ROOT;
  rmSync(tmpDir, { recursive: true, force: true });
  resetConfigCache();
  resetPolicyCache();
  resetRegistryCache();
});

describe('parseCommand', () => {
  it('recognizes /pilotlynx-bind format', () => {
    const result = parseCommand('/pilotlynx-bind my-project');
    expect(result).toEqual({ command: 'bind', args: 'my-project' });
  });

  it('recognizes /pilotlynx bind format', () => {
    const result = parseCommand('/pilotlynx bind my-project');
    expect(result).toEqual({ command: 'bind', args: 'my-project' });
  });

  it('recognizes !bind format', () => {
    const result = parseCommand('!bind my-project');
    expect(result).toEqual({ command: 'bind', args: 'my-project' });
  });

  it('recognizes bare "bind" as a command', () => {
    const result = parseCommand('bind my-project');
    expect(result).toEqual({ command: 'bind', args: 'my-project' });
  });

  it('returns null for unknown commands', () => {
    const result = parseCommand('/pilotlynx-unknown something');
    expect(result).toBeNull();
  });

  it('returns null for arbitrary text', () => {
    const result = parseCommand('Hello, this is a normal message');
    expect(result).toBeNull();
  });

  it('recognizes help command', () => {
    const result = parseCommand('help');
    expect(result).toEqual({ command: 'help', args: '' });
  });
});

describe('isAdmin', () => {
  it('returns true for configured admin user', () => {
    expect(isAdmin(baseConfig, 'slack', 'U-ADMIN')).toBe(true);
  });

  it('returns false for non-admin user', () => {
    expect(isAdmin(baseConfig, 'slack', 'U-NOBODY')).toBe(false);
  });

  it('returns false for unknown platform', () => {
    expect(isAdmin(baseConfig, 'discord', 'U-ADMIN')).toBe(false);
  });
});

describe('handleAdminCommand', () => {
  it('bind validates project existence', async () => {
    // Mock listProjects to return empty - the module calls it internally
    // Since we can't easily mock ESM, we test the "project not found" path
    const ctx = {
      db,
      platform: 'slack',
      channelId: 'C1',
      userId: 'U-ADMIN',
      config: baseConfig,
    };

    const result = await handleAdminCommand(ctx, 'bind', 'nonexistent-proj');
    expect(result).toContain('not found');
  });

  it('help returns help text with available commands', async () => {
    const ctx = {
      db,
      platform: 'slack',
      channelId: 'C1',
      userId: 'U-ADMIN',
      config: baseConfig,
    };

    const result = await handleAdminCommand(ctx, 'help', '');
    expect(result).toContain('PilotLynx Relay Commands');
    expect(result).toContain('bind');
    expect(result).toContain('unbind');
    expect(result).toContain('status');
    expect(result).toContain('help');
  });

  it('denies admin-only commands for non-admin users', async () => {
    const ctx = {
      db,
      platform: 'slack',
      channelId: 'C1',
      userId: 'U-NOBODY',
      config: baseConfig,
    };

    const result = await handleAdminCommand(ctx, 'bind', 'some-project');
    expect(result).toContain('Permission denied');
  });

  it('allows non-admin commands for regular users', async () => {
    const ctx = {
      db,
      platform: 'slack',
      channelId: 'C1',
      userId: 'U-NOBODY',
      config: baseConfig,
    };

    const result = await handleAdminCommand(ctx, 'help', '');
    expect(result).toContain('PilotLynx Relay Commands');
  });

  it('status returns uptime and active run info', async () => {
    const ctx = {
      db,
      platform: 'slack',
      channelId: 'C1',
      userId: 'U-ADMIN',
      config: baseConfig,
      getActiveCount: () => 2,
      startedAt: new Date(Date.now() - 60_000),
    };

    const result = await handleAdminCommand(ctx, 'status', '');
    expect(result).toContain('Relay status');
    expect(result).toContain('Active runs: 2');
    expect(result).toContain('Uptime:');
  });

  it('where shows binding when channel is bound', async () => {
    saveBinding(db, 'slack', 'C1', 'my-proj', 'U-ADMIN');

    const ctx = {
      db,
      platform: 'slack',
      channelId: 'C1',
      userId: 'U-NOBODY',
      config: baseConfig,
    };

    const result = await handleAdminCommand(ctx, 'where', '');
    expect(result).toContain('my-proj');
  });
});
