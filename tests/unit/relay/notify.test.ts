import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../../src/lib/config.js';
import { resetRelayConfigCache } from '../../../src/lib/relay/config.js';

// Mock grammy's Api before importing notify
vi.mock('grammy', () => ({
  Api: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn().mockResolvedValue({}),
  })),
}));

import { sendRunNotification } from '../../../src/lib/relay/notify.js';
import { Api } from 'grammy';
import type { RunRecord } from '../../../src/lib/types.js';

describe('sendRunNotification', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-relay-notify-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'plynx.yaml'), stringifyYaml({ version: 1, name: 'test' }));
    writeFileSync(join(configDir, '.env'), 'TELEGRAM_BOT_TOKEN=test-token-123\n');
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

  const sampleRecord: RunRecord = {
    project: 'my-project',
    workflow: 'daily_check',
    startedAt: '2025-01-01T00:00:00Z',
    completedAt: '2025-01-01T00:01:30Z',
    success: true,
    summary: 'All checks passed.',
    costUsd: 0.0123,
    numTurns: 5,
  };

  it('does nothing when relay.yaml does not exist', async () => {
    await sendRunNotification(sampleRecord);
    expect(Api).not.toHaveBeenCalled();
  });

  it('does nothing when relay is disabled', async () => {
    writeFileSync(
      join(configDir, 'relay.yaml'),
      stringifyYaml({ version: 1, enabled: false }),
    );
    resetRelayConfigCache();
    await sendRunNotification(sampleRecord);
    expect(Api).not.toHaveBeenCalled();
  });

  it('sends to Telegram chats configured for the project', async () => {
    writeFileSync(
      join(configDir, 'relay.yaml'),
      stringifyYaml({
        version: 1,
        enabled: true,
        channels: { telegram: { enabled: true } },
        routing: {
          chats: {
            'telegram:12345': {
              project: 'my-project',
              notifySchedule: true,
            },
          },
        },
      }),
    );
    resetRelayConfigCache();

    await sendRunNotification(sampleRecord);

    expect(Api).toHaveBeenCalledWith('test-token-123');
    const mockApi = vi.mocked(Api).mock.results[0].value;
    expect(mockApi.sendMessage).toHaveBeenCalledWith(
      '12345',
      expect.stringContaining('my-project/daily_check'),
      expect.any(Object),
    );
  });

  it('skips chats not configured for this project', async () => {
    writeFileSync(
      join(configDir, 'relay.yaml'),
      stringifyYaml({
        version: 1,
        enabled: true,
        channels: { telegram: { enabled: true } },
        routing: {
          chats: {
            'telegram:12345': {
              project: 'other-project',
              notifySchedule: true,
            },
          },
        },
      }),
    );
    resetRelayConfigCache();

    await sendRunNotification(sampleRecord);
    // Api may be created but sendMessage should not be called
    if (vi.mocked(Api).mock.results.length > 0) {
      expect(vi.mocked(Api).mock.results[0].value.sendMessage).not.toHaveBeenCalled();
    }
  });

  it('skips chats with notifySchedule: false', async () => {
    writeFileSync(
      join(configDir, 'relay.yaml'),
      stringifyYaml({
        version: 1,
        enabled: true,
        channels: { telegram: { enabled: true } },
        routing: {
          chats: {
            'telegram:12345': {
              project: 'my-project',
              notifySchedule: false,
            },
          },
        },
      }),
    );
    resetRelayConfigCache();

    await sendRunNotification(sampleRecord);
    if (vi.mocked(Api).mock.results.length > 0) {
      expect(vi.mocked(Api).mock.results[0].value.sendMessage).not.toHaveBeenCalled();
    }
  });

  it('does not send success notifications when onScheduleComplete is false', async () => {
    writeFileSync(
      join(configDir, 'relay.yaml'),
      stringifyYaml({
        version: 1,
        enabled: true,
        channels: { telegram: { enabled: true } },
        notifications: { onScheduleComplete: false, onScheduleFailure: true },
        routing: {
          chats: {
            'telegram:12345': { project: 'my-project', notifySchedule: true },
          },
        },
      }),
    );
    resetRelayConfigCache();

    await sendRunNotification(sampleRecord); // success record
    expect(Api).not.toHaveBeenCalled();
  });

  it('logs dead letters for webhook failures', async () => {
    // Mock fetch to fail
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });

    writeFileSync(
      join(configDir, 'relay.yaml'),
      stringifyYaml({
        version: 1,
        enabled: true,
        channels: { webhook: { enabled: true } },
        routing: {
          chats: {
            'webhook:https://example.com/hook': {
              project: 'my-project',
              notifySchedule: true,
            },
          },
        },
      }),
    );
    resetRelayConfigCache();

    await sendRunNotification(sampleRecord);

    const deadLetterPath = join(configDir, 'relay', 'dead-letters.jsonl');
    expect(existsSync(deadLetterPath)).toBe(true);
    const content = readFileSync(deadLetterPath, 'utf8');
    expect(content).toContain('HTTP 403');

    globalThis.fetch = originalFetch;
  });
});
