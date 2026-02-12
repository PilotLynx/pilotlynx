import { describe, it, expect } from 'vitest';
import { RelayConfigSchema, ChatConfigSchema } from '../../../src/lib/relay/types.js';

describe('RelayConfigSchema', () => {
  it('parses a full config', () => {
    const raw = {
      version: 1,
      enabled: true,
      channels: {
        telegram: { enabled: true },
        webhook: { enabled: false },
      },
      notifications: {
        onScheduleComplete: true,
        onScheduleFailure: true,
      },
      routing: {
        defaultProject: 'my-project',
        chats: {
          'telegram:123': {
            project: 'my-project',
            allowRun: true,
            allowChat: true,
            notifySchedule: true,
          },
        },
        allowedUsers: ['456'],
      },
    };
    const result = RelayConfigSchema.parse(raw);
    expect(result.version).toBe(1);
    expect(result.channels.telegram.enabled).toBe(true);
    expect(result.routing.chats['telegram:123'].project).toBe('my-project');
    expect(result.routing.allowedUsers).toEqual(['456']);
  });

  it('applies defaults for minimal config', () => {
    const result = RelayConfigSchema.parse({ version: 1 });
    expect(result.enabled).toBe(true);
    expect(result.channels.telegram.enabled).toBe(false);
    expect(result.channels.webhook.enabled).toBe(false);
    expect(result.notifications.onScheduleComplete).toBe(true);
    expect(result.routing.defaultProject).toBeNull();
    expect(result.routing.chats).toEqual({});
    expect(result.routing.allowedUsers).toEqual([]);
  });

  it('rejects missing version', () => {
    expect(() => RelayConfigSchema.parse({})).toThrow();
  });

  it('rejects unknown top-level keys with strict mode', () => {
    expect(() => RelayConfigSchema.parse({
      version: 1,
      unknownKey: 'bad',
    })).toThrow();
  });
});

describe('ChatConfigSchema', () => {
  it('applies defaults', () => {
    const result = ChatConfigSchema.parse({});
    expect(result.allowRun).toBe(true);
    expect(result.allowChat).toBe(true);
    expect(result.notifySchedule).toBe(true);
    expect(result.project).toBeUndefined();
  });

  it('parses full chat config', () => {
    const result = ChatConfigSchema.parse({
      project: 'test',
      allowRun: false,
      allowChat: false,
      notifySchedule: false,
    });
    expect(result.project).toBe('test');
    expect(result.allowRun).toBe(false);
  });

  it('rejects unknown keys with strict mode', () => {
    expect(() => ChatConfigSchema.parse({
      project: 'test',
      unknownKey: 'bad',
    })).toThrow();
  });
});
