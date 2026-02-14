import { describe, it, expect } from 'vitest';
import { WebhookConfigSchema } from '../../../src/lib/relay/types.js';

describe('WebhookConfigSchema', () => {
  it('parses a full config', () => {
    const raw = {
      version: 1,
      enabled: true,
      webhooks: [
        {
          name: 'slack',
          url: 'https://hooks.slack.com/test',
          events: ['run_complete', 'run_failed'],
          headers: { 'X-Custom': 'value' },
          secret: 'my-secret',
        },
      ],
    };
    const result = WebhookConfigSchema.parse(raw);
    expect(result.version).toBe(1);
    expect(result.enabled).toBe(true);
    expect(result.webhooks).toHaveLength(1);
    expect(result.webhooks[0].name).toBe('slack');
    expect(result.webhooks[0].url).toBe('https://hooks.slack.com/test');
    expect(result.webhooks[0].events).toEqual(['run_complete', 'run_failed']);
    expect(result.webhooks[0].headers).toEqual({ 'X-Custom': 'value' });
    expect(result.webhooks[0].secret).toBe('my-secret');
  });

  it('applies defaults for minimal config', () => {
    const result = WebhookConfigSchema.parse({});
    expect(result.version).toBe(1);
    expect(result.enabled).toBe(false);
    expect(result.webhooks).toEqual([]);
  });

  it('applies default events for webhook entry', () => {
    const result = WebhookConfigSchema.parse({
      version: 1,
      enabled: true,
      webhooks: [{ name: 'test', url: 'https://example.com/hook' }],
    });
    expect(result.webhooks[0].events).toEqual(['run_complete', 'run_failed']);
  });

  it('rejects invalid URL', () => {
    expect(() => WebhookConfigSchema.parse({
      webhooks: [{ name: 'bad', url: 'not-a-url' }],
    })).toThrow();
  });

  it('rejects invalid event names', () => {
    expect(() => WebhookConfigSchema.parse({
      webhooks: [{ name: 'bad', url: 'https://example.com/hook', events: ['invalid_event'] }],
    })).toThrow();
  });
});
