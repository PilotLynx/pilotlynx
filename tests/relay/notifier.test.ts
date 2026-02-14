import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import Database from 'better-sqlite3';
import { initDb } from '../../src/lib/relay/db.js';
import { saveBinding } from '../../src/lib/relay/bindings.js';
import { RelayNotifier } from '../../src/lib/relay/notifier.js';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../src/lib/config.js';
import { resetPolicyCache } from '../../src/lib/policy.js';
import { resetRegistryCache } from '../../src/lib/registry.js';
import type { RelayConfig } from '../../src/lib/relay/types.js';
import type { ChatPlatform } from '../../src/lib/relay/platform.js';
import type { RunRecord } from '../../src/lib/types.js';

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
  },
  notifications: {
    scheduleFailures: true,
    improveInsights: true,
    budgetAlerts: true,
    healthScoreThreshold: 50,
  },
  admins: {
    slack: ['U-ADMIN'],
    telegram: [],
  },
};

function createMockPlatform(): ChatPlatform {
  return {
    name: 'slack',
    capabilities: {
      nativeStreaming: true,
      maxStreamUpdateHz: 10,
      supportsReactions: true,
      supportsSlashCommands: true,
      supportsThreads: true,
      maxMessageLength: 4000,
    },
    start: vi.fn(),
    stop: vi.fn(),
    sendMessage: vi.fn(async () => 'msg-ts'),
    updateMessage: vi.fn(),
    startStream: vi.fn(),
    uploadFile: vi.fn(),
    getThreadHistory: vi.fn(async () => []),
    onMessage: vi.fn(),
    onReaction: vi.fn(),
    onCommand: vi.fn(),
  } as any;
}

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

describe('RelayNotifier', () => {
  it('sends schedule result to bound channel', async () => {
    const platform = createMockPlatform();
    const platforms = new Map<string, ChatPlatform>([['slack', platform]]);

    saveBinding(db, 'slack', 'C1', 'my-proj', 'U-ADMIN');

    const notifier = new RelayNotifier(platforms, db, baseConfig);

    const record: RunRecord = {
      project: 'my-proj',
      workflow: 'daily-check',
      startedAt: new Date(Date.now() - 30_000).toISOString(),
      completedAt: new Date().toISOString(),
      success: true,
      costUsd: 0.05,
      model: 'claude-sonnet-4-5-20250929',
      triggeredBy: 'schedule',
      durationMs: 30_000,
      inputTokens: 1000,
      outputTokens: 500,
      numTurns: 5,
    };

    await notifier.notifyScheduleResult('my-proj', record);
    expect(platform.sendMessage).toHaveBeenCalledWith(
      'C1',
      expect.stringContaining('daily-check'),
    );
    expect(platform.sendMessage).toHaveBeenCalledWith(
      'C1',
      expect.stringContaining('Success'),
    );
  });

  it('sends improve insights to bound channel', async () => {
    const platform = createMockPlatform();
    const platforms = new Map<string, ChatPlatform>([['slack', platform]]);

    saveBinding(db, 'slack', 'C1', 'my-proj', 'U-ADMIN');

    const notifier = new RelayNotifier(platforms, db, baseConfig);
    await notifier.notifyImproveInsights('my-proj', ['Found unused code', 'Test coverage low']);

    expect(platform.sendMessage).toHaveBeenCalledWith(
      'C1',
      expect.stringContaining('Found unused code'),
    );
  });

  it('does not send improve insights when disabled', async () => {
    const config = {
      ...baseConfig,
      notifications: { ...baseConfig.notifications, improveInsights: false },
    };
    const platform = createMockPlatform();
    const platforms = new Map<string, ChatPlatform>([['slack', platform]]);

    saveBinding(db, 'slack', 'C1', 'my-proj', 'U-ADMIN');

    const notifier = new RelayNotifier(platforms, db, config);
    await notifier.notifyImproveInsights('my-proj', ['insight']);

    expect(platform.sendMessage).not.toHaveBeenCalled();
  });

  it('sends budget alert to bound channel', async () => {
    const platform = createMockPlatform();
    const platforms = new Map<string, ChatPlatform>([['slack', platform]]);

    saveBinding(db, 'slack', 'C1', 'my-proj', 'U-ADMIN');

    const notifier = new RelayNotifier(platforms, db, baseConfig);
    await notifier.notifyBudgetAlert('my-proj', 8.5, 10);

    expect(platform.sendMessage).toHaveBeenCalledWith(
      'C1',
      expect.stringContaining('85%'),
    );
  });

  it('sends health drop to bound channel when below threshold', async () => {
    const platform = createMockPlatform();
    const platforms = new Map<string, ChatPlatform>([['slack', platform]]);

    saveBinding(db, 'slack', 'C1', 'my-proj', 'U-ADMIN');

    const notifier = new RelayNotifier(platforms, db, baseConfig);
    await notifier.notifyHealthDrop('my-proj', 70, 40);

    expect(platform.sendMessage).toHaveBeenCalledWith(
      'C1',
      expect.stringContaining('70'),
    );
  });

  it('does not send health drop when score is above threshold', async () => {
    const platform = createMockPlatform();
    const platforms = new Map<string, ChatPlatform>([['slack', platform]]);

    saveBinding(db, 'slack', 'C1', 'my-proj', 'U-ADMIN');

    const notifier = new RelayNotifier(platforms, db, baseConfig);
    await notifier.notifyHealthDrop('my-proj', 80, 60);

    expect(platform.sendMessage).not.toHaveBeenCalled();
  });

  it('does not send when project has no bound channel', async () => {
    const platform = createMockPlatform();
    const platforms = new Map<string, ChatPlatform>([['slack', platform]]);

    // No binding for 'orphan-proj'
    const notifier = new RelayNotifier(platforms, db, baseConfig);
    await notifier.notifyBudgetAlert('orphan-proj', 9, 10);

    expect(platform.sendMessage).not.toHaveBeenCalled();
  });

  it('skips empty insights array', async () => {
    const platform = createMockPlatform();
    const platforms = new Map<string, ChatPlatform>([['slack', platform]]);

    saveBinding(db, 'slack', 'C1', 'my-proj', 'U-ADMIN');

    const notifier = new RelayNotifier(platforms, db, baseConfig);
    await notifier.notifyImproveInsights('my-proj', []);

    expect(platform.sendMessage).not.toHaveBeenCalled();
  });

  it('handles sendMessage errors gracefully', async () => {
    const platform = createMockPlatform();
    (platform.sendMessage as any).mockRejectedValue(new Error('network error'));
    const platforms = new Map<string, ChatPlatform>([['slack', platform]]);

    saveBinding(db, 'slack', 'C1', 'my-proj', 'U-ADMIN');

    const notifier = new RelayNotifier(platforms, db, baseConfig);
    // Should not throw
    await notifier.notifyBudgetAlert('my-proj', 9, 10);
  });
});
