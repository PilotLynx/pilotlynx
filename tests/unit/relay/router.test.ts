import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../../src/lib/config.js';
import { resetRelayConfigCache } from '../../../src/lib/relay/config.js';

// Mock dependencies
vi.mock('../../../src/lib/command-ops/run-ops.js', () => ({
  executeRun: vi.fn().mockResolvedValue({
    success: true,
    durationMs: 5000,
    costUsd: 0.01,
    record: { summary: 'Done' },
  }),
}));

vi.mock('../../../src/lib/relay/locks.js', () => ({
  acquireRunLock: vi.fn().mockResolvedValue(async () => {}),
}));

vi.mock('../../../src/lib/relay/chat.js', () => ({
  runRelayChatAgent: vi.fn().mockResolvedValue('Test reply'),
}));

vi.mock('../../../src/lib/relay/history.js', () => ({
  appendConversation: vi.fn().mockResolvedValue(undefined),
  getRecentConversation: vi.fn().mockReturnValue([]),
}));

vi.mock('../../../src/lib/observation.js', () => ({
  getRecentLogs: vi.fn().mockReturnValue([]),
}));

vi.mock('../../../src/lib/project.js', () => ({
  listProjects: vi.fn().mockReturnValue(['project-a', 'project-b']),
}));

import { createRouter } from '../../../src/lib/relay/router.js';
import { executeRun } from '../../../src/lib/command-ops/run-ops.js';
import { acquireRunLock } from '../../../src/lib/relay/locks.js';
import { runRelayChatAgent } from '../../../src/lib/relay/chat.js';
import type { ChannelAdapter, InboundMessage } from '../../../src/lib/relay/channel.js';

function createMockAdapter(): ChannelAdapter {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    send: vi.fn().mockResolvedValue(undefined),
    sendTyping: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    chatId: 'telegram:123',
    userId: '456',
    username: 'testuser',
    text: '/help',
    channel: 'telegram',
    ...overrides,
  };
}

describe('router', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-router-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'plynx.yaml'), stringifyYaml({ version: 1, name: 'test' }));
    writeFileSync(
      join(configDir, 'relay.yaml'),
      stringifyYaml({
        version: 1,
        enabled: true,
        channels: { telegram: { enabled: true } },
        routing: {
          chats: {
            'telegram:123': {
              project: 'project-a',
              allowRun: true,
              allowChat: true,
              notifySchedule: true,
            },
          },
          allowedUsers: [],
        },
      }),
    );
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetRelayConfigCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.PILOTLYNX_ROOT = origEnv;
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    resetRelayConfigCache();
  });

  it('returns help text for /help', async () => {
    const adapter = createMockAdapter();
    const router = createRouter(adapter);
    await router(makeMsg({ text: '/help' }));
    expect(adapter.send).toHaveBeenCalledWith('telegram:123', expect.stringContaining('PilotLynx Relay'));
  });

  it('lists projects for /projects', async () => {
    const adapter = createMockAdapter();
    const router = createRouter(adapter);
    await router(makeMsg({ text: '/projects' }));
    expect(adapter.send).toHaveBeenCalledWith('telegram:123', expect.stringContaining('project-a'));
  });

  it('shows status for /status', async () => {
    const adapter = createMockAdapter();
    const router = createRouter(adapter);
    await router(makeMsg({ text: '/status' }));
    expect(adapter.send).toHaveBeenCalledWith('telegram:123', expect.stringContaining('project-a'));
  });

  it('rejects unauthorized users', async () => {
    writeFileSync(
      join(configDir, 'relay.yaml'),
      stringifyYaml({
        version: 1,
        enabled: true,
        channels: { telegram: { enabled: true } },
        routing: {
          chats: { 'telegram:123': { project: 'project-a' } },
          allowedUsers: ['999'],
        },
      }),
    );
    resetRelayConfigCache();

    const adapter = createMockAdapter();
    const router = createRouter(adapter);
    await router(makeMsg({ text: '/help', userId: '456' }));
    expect(adapter.send).toHaveBeenCalledWith('telegram:123', expect.stringContaining('Unauthorized'));
  });

  it('sends setup instructions for unmapped chats', async () => {
    const adapter = createMockAdapter();
    const router = createRouter(adapter);
    await router(makeMsg({ chatId: 'telegram:999', text: '/help' }));
    expect(adapter.send).toHaveBeenCalledWith('telegram:999', expect.stringContaining('plynx relay add-chat'));
  });

  it('/run with project and workflow executes run', async () => {
    const adapter = createMockAdapter();
    const router = createRouter(adapter);
    await router(makeMsg({ text: '/run project-a my-workflow' }));
    expect(executeRun).toHaveBeenCalledWith('project-a', 'my-workflow');
  });

  it('/run with single arg uses default project', async () => {
    const adapter = createMockAdapter();
    const router = createRouter(adapter);
    await router(makeMsg({ text: '/run my-workflow' }));
    expect(executeRun).toHaveBeenCalledWith('project-a', 'my-workflow');
  });

  it('/run with no args shows usage', async () => {
    const adapter = createMockAdapter();
    const router = createRouter(adapter);
    await router(makeMsg({ text: '/run' }));
    expect(adapter.send).toHaveBeenCalledWith('telegram:123', expect.stringContaining('Usage'));
    expect(executeRun).not.toHaveBeenCalled();
  });

  it('/run when allowRun=false denies', async () => {
    writeFileSync(
      join(configDir, 'relay.yaml'),
      stringifyYaml({
        version: 1,
        enabled: true,
        channels: { telegram: { enabled: true } },
        routing: {
          chats: {
            'telegram:123': { project: 'project-a', allowRun: false },
          },
        },
      }),
    );
    resetRelayConfigCache();

    const adapter = createMockAdapter();
    const router = createRouter(adapter);
    await router(makeMsg({ text: '/run project-a wf' }));
    expect(adapter.send).toHaveBeenCalledWith('telegram:123', expect.stringContaining('disabled'));
    expect(executeRun).not.toHaveBeenCalled();
  });

  it('shows busy message when lock cannot be acquired', async () => {
    vi.mocked(acquireRunLock).mockResolvedValueOnce(null);
    const adapter = createMockAdapter();
    const router = createRouter(adapter);
    await router(makeMsg({ text: '/run project-a wf' }));
    expect(adapter.send).toHaveBeenCalledWith('telegram:123', expect.stringContaining('busy'));
  });

  it('sends unknown command message', async () => {
    const adapter = createMockAdapter();
    const router = createRouter(adapter);
    await router(makeMsg({ text: '/foobar' }));
    expect(adapter.send).toHaveBeenCalledWith('telegram:123', expect.stringContaining('Unknown command'));
  });

  it('sends chat disabled message when allowChat is false', async () => {
    writeFileSync(
      join(configDir, 'relay.yaml'),
      stringifyYaml({
        version: 1,
        enabled: true,
        channels: { telegram: { enabled: true } },
        routing: {
          chats: {
            'telegram:123': { project: 'project-a', allowChat: false },
          },
        },
      }),
    );
    resetRelayConfigCache();

    const adapter = createMockAdapter();
    const router = createRouter(adapter);
    await router(makeMsg({ text: 'hello there' }));
    expect(adapter.send).toHaveBeenCalledWith('telegram:123', expect.stringContaining('disabled'));
  });

  it('handles chat messages when allowChat is true', async () => {
    const adapter = createMockAdapter();
    const router = createRouter(adapter);
    await router(makeMsg({ text: 'hello there' }));
    expect(runRelayChatAgent).toHaveBeenCalled();
    expect(adapter.send).toHaveBeenCalledWith('telegram:123', 'Test reply');
  });

  it('does nothing when relay is disabled', async () => {
    writeFileSync(
      join(configDir, 'relay.yaml'),
      stringifyYaml({ version: 1, enabled: false }),
    );
    resetRelayConfigCache();

    const adapter = createMockAdapter();
    const router = createRouter(adapter);
    await router(makeMsg({ text: '/help' }));
    expect(adapter.send).not.toHaveBeenCalled();
  });
});
