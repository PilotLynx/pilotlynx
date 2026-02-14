import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import Database from 'better-sqlite3';
import { initDb } from '../../src/lib/relay/db.js';
import { saveBinding } from '../../src/lib/relay/bindings.js';
import { RelayRouter } from '../../src/lib/relay/router.js';
import { AgentPool } from '../../src/lib/relay/queue.js';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../src/lib/config.js';
import { resetPolicyCache } from '../../src/lib/policy.js';
import { resetRegistryCache } from '../../src/lib/registry.js';
import type { RelayConfig } from '../../src/lib/relay/types.js';
import type { ChatPlatform, ChatMessage, PlatformCapabilities, StreamHandle } from '../../src/lib/relay/platform.js';

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
    telegram: [],
  },
};

function createMockPlatform(): ChatPlatform {
  const sent: Array<{ channelId: string; text: string; threadId?: string }> = [];
  return {
    name: 'slack',
    capabilities: {
      nativeStreaming: true,
      maxStreamUpdateHz: 10,
      supportsReactions: true,
      supportsSlashCommands: true,
      supportsThreads: true,
      maxMessageLength: 4000,
    } as PlatformCapabilities,
    start: vi.fn(),
    stop: vi.fn(),
    sendMessage: vi.fn(async (channelId: string, text: string, threadId?: string) => {
      sent.push({ channelId, text, threadId });
      return 'msg-ts';
    }),
    updateMessage: vi.fn(),
    startStream: vi.fn(async (): Promise<StreamHandle> => ({
      append: vi.fn(),
      stop: vi.fn(),
    })),
    uploadFile: vi.fn(),
    getThreadHistory: vi.fn(async () => []),
    onMessage: vi.fn(),
    onReaction: vi.fn(),
    onCommand: vi.fn(),
    _sent: sent,
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

describe('RelayRouter', () => {
  it('ignores bot messages', async () => {
    const pool = new AgentPool(3, 10);
    const router = new RelayRouter(db, pool, baseConfig);
    const platform = createMockPlatform();

    const msg: ChatMessage = {
      platform: 'slack',
      channelId: 'C1',
      conversationId: 'thread-1',
      messageId: 'msg-1',
      userId: 'BOT',
      userName: 'bot',
      text: 'I am a bot',
      timestamp: '12345.000',
      isBot: true,
    };

    await router.routeMessage(platform, msg);
    // Bot messages are ignored — no sendMessage call
    expect(platform.sendMessage).not.toHaveBeenCalled();
  });

  it('responds with unbound message for unbound channels', async () => {
    const pool = new AgentPool(3, 10);
    const router = new RelayRouter(db, pool, baseConfig);
    const platform = createMockPlatform();

    const msg: ChatMessage = {
      platform: 'slack',
      channelId: 'C-UNBOUND',
      conversationId: 'thread-1',
      messageId: 'msg-1',
      userId: 'U1',
      userName: 'alice',
      text: 'hello',
      timestamp: '12345.000',
      isBot: false,
    };

    await router.routeMessage(platform, msg);
    expect(platform.sendMessage).toHaveBeenCalledWith(
      'C-UNBOUND',
      expect.stringContaining('not bound'),
      'thread-1',
    );
  });

  it('routes admin commands before checking binding', async () => {
    const pool = new AgentPool(3, 10);
    const router = new RelayRouter(db, pool, baseConfig);
    const platform = createMockPlatform();

    const msg: ChatMessage = {
      platform: 'slack',
      channelId: 'C1',
      conversationId: 'thread-1',
      messageId: 'msg-1',
      userId: 'U-ADMIN',
      userName: 'admin',
      text: 'help',
      timestamp: '12345.000',
      isBot: false,
    };

    await router.routeMessage(platform, msg);
    expect(platform.sendMessage).toHaveBeenCalledWith(
      'C1',
      expect.stringContaining('PilotLynx Relay Commands'),
      'thread-1',
    );
  });

  it('rate limits users who send too many messages', async () => {
    const config = {
      ...baseConfig,
      limits: { ...baseConfig.limits, userRatePerHour: 2 },
    };
    const pool = new AgentPool(3, 10);
    const router = new RelayRouter(db, pool, config);
    const platform = createMockPlatform();

    saveBinding(db, 'slack', 'C1', 'my-proj', 'U-ADMIN');

    // Use a unique userId to avoid cross-test state
    const userId = 'rate-test-' + Math.random().toString(36).slice(2);

    for (let i = 0; i < 3; i++) {
      const msg: ChatMessage = {
        platform: 'slack',
        channelId: 'C1',
        conversationId: `thread-${i}`,
        messageId: `msg-${i}`,
        userId,
        userName: 'alice',
        text: `message ${i}`,
        timestamp: `${Date.now()}.000`,
        isBot: false,
      };
      await router.routeMessage(platform, msg);
    }

    // The 3rd message should have been rate-limited
    const calls = (platform.sendMessage as any).mock.calls;
    const rateLimitCall = calls.find((c: any[]) =>
      typeof c[1] === 'string' && c[1].includes('too quickly'),
    );
    expect(rateLimitCall).toBeDefined();
  });

  it('routeReaction ignores unknown emoji', async () => {
    const pool = new AgentPool(3, 10);
    const router = new RelayRouter(db, pool, baseConfig);
    const platform = createMockPlatform();

    saveBinding(db, 'slack', 'C1', 'my-proj', 'U-ADMIN');

    await router.routeReaction(platform, 'C1', 'msg-1', 'U1', 'pizza');
    // Unknown emoji should not trigger any message
    expect(platform.sendMessage).not.toHaveBeenCalled();
  });

  it('routeReaction handles negative feedback with follow-up prompt', async () => {
    const pool = new AgentPool(3, 10);
    const router = new RelayRouter(db, pool, baseConfig);
    const platform = createMockPlatform();

    saveBinding(db, 'slack', 'C1', 'my-proj', 'U-ADMIN');

    await router.routeReaction(platform, 'C1', 'msg-1', 'U1', 'thumbsdown');
    expect(platform.sendMessage).toHaveBeenCalledWith(
      'C1',
      expect.stringContaining('what went wrong'),
      'msg-1',
    );
  });

  it('routeCommand delegates to admin handler', async () => {
    const pool = new AgentPool(3, 10);
    const router = new RelayRouter(db, pool, baseConfig);
    const platform = createMockPlatform();

    const result = await router.routeCommand(platform, 'C1', 'U-ADMIN', 'help', '');
    expect(result).toContain('PilotLynx Relay Commands');
  });
});
