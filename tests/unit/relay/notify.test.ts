import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../../src/lib/config.js';
import { sendRunNotification, sendWebhookNotification } from '../../../src/lib/relay/notify.js';
import type { RunRecord } from '../../../src/lib/types.js';
import type { WebhookPayload } from '../../../src/lib/relay/types.js';

describe('sendRunNotification', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pilotlynx-webhook-notify-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'pilotlynx.yaml'), stringifyYaml({ version: 1, name: 'test' }));
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => {
    process.env.PILOTLYNX_ROOT = origEnv;
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    globalThis.fetch = originalFetch;
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

  it('does nothing when webhook.yaml does not exist', async () => {
    await sendRunNotification(sampleRecord);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does nothing when webhooks are disabled', async () => {
    writeFileSync(
      join(configDir, 'webhook.yaml'),
      stringifyYaml({ version: 1, enabled: false, webhooks: [] }),
    );
    await sendRunNotification(sampleRecord);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('sends to webhooks that match the event', async () => {
    writeFileSync(
      join(configDir, 'webhook.yaml'),
      stringifyYaml({
        version: 1,
        enabled: true,
        webhooks: [
          { name: 'slack', url: 'https://hooks.slack.com/test', events: ['run_complete'] },
        ],
      }),
    );

    await sendRunNotification(sampleRecord);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/test',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('my-project'),
      }),
    );
  });

  it('skips webhooks that do not match the event', async () => {
    writeFileSync(
      join(configDir, 'webhook.yaml'),
      stringifyYaml({
        version: 1,
        enabled: true,
        webhooks: [
          { name: 'slack', url: 'https://hooks.slack.com/test', events: ['improve_complete'] },
        ],
      }),
    );

    await sendRunNotification(sampleRecord);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('sends run_failed event for failed records', async () => {
    writeFileSync(
      join(configDir, 'webhook.yaml'),
      stringifyYaml({
        version: 1,
        enabled: true,
        webhooks: [
          { name: 'alerts', url: 'https://example.com/hook', events: ['run_failed'] },
        ],
      }),
    );

    const failedRecord: RunRecord = {
      ...sampleRecord,
      success: false,
      error: 'Something went wrong',
    };
    await sendRunNotification(failedRecord);

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.event).toBe('run_failed');
    expect(body.success).toBe(false);
  });

  it('includes HMAC signature when secret is configured', async () => {
    writeFileSync(
      join(configDir, 'webhook.yaml'),
      stringifyYaml({
        version: 1,
        enabled: true,
        webhooks: [
          { name: 'secure', url: 'https://example.com/hook', events: ['run_complete'], secret: 'test-secret' },
        ],
      }),
    );

    await sendRunNotification(sampleRecord);

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const headers = (globalThis.fetch as any).mock.calls[0][1].headers;
    expect(headers['X-PilotLynx-Signature']).toMatch(/^sha256=[0-9a-f]+$/);
  });

  it('logs error to console on fetch failure without throwing', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    writeFileSync(
      join(configDir, 'webhook.yaml'),
      stringifyYaml({
        version: 1,
        enabled: true,
        webhooks: [
          { name: 'failing', url: 'https://example.com/hook', events: ['run_complete'] },
        ],
      }),
    );

    await sendRunNotification(sampleRecord);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Webhook "failing" failed'),
    );
    consoleSpy.mockRestore();
  });
});

describe('sendWebhookNotification', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pilotlynx-webhook-direct-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'pilotlynx.yaml'), stringifyYaml({ version: 1, name: 'test' }));
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => {
    process.env.PILOTLYNX_ROOT = origEnv;
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    globalThis.fetch = originalFetch;
  });

  it('sends payload with custom headers', async () => {
    writeFileSync(
      join(configDir, 'webhook.yaml'),
      stringifyYaml({
        version: 1,
        enabled: true,
        webhooks: [
          {
            name: 'custom',
            url: 'https://example.com/hook',
            events: ['run_complete'],
            headers: { 'X-Custom': 'value' },
          },
        ],
      }),
    );

    const payload: WebhookPayload = {
      event: 'run_complete',
      timestamp: new Date().toISOString(),
      project: 'test',
      workflow: 'build',
      success: true,
      summary: 'OK',
      costUsd: 0.01,
    };

    await sendWebhookNotification(payload);

    const headers = (globalThis.fetch as any).mock.calls[0][1].headers;
    expect(headers['X-Custom']).toBe('value');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['User-Agent']).toBe('PilotLynx-Webhook/1.0');
  });
});
