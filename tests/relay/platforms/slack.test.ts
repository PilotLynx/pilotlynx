import { describe, it, expect } from 'vitest';
import { SlackAdapter } from '../../../src/lib/relay/platforms/slack.js';

describe('SlackAdapter', () => {
  it('has correct platform name', () => {
    const adapter = new SlackAdapter({
      botToken: 'xoxb-test',
      appToken: 'xapp-test',
      signingSecret: 'test-secret',
      mode: 'socket',
      port: 3210,
    });
    expect(adapter.name).toBe('slack');
  });

  it('reports correct capabilities', () => {
    const adapter = new SlackAdapter({
      botToken: 'xoxb-test',
      appToken: 'xapp-test',
      signingSecret: 'test-secret',
      mode: 'socket',
      port: 3210,
    });
    expect(adapter.capabilities.nativeStreaming).toBe(true);
    expect(adapter.capabilities.maxStreamUpdateHz).toBe(10);
    expect(adapter.capabilities.supportsReactions).toBe(true);
    expect(adapter.capabilities.supportsSlashCommands).toBe(true);
    expect(adapter.capabilities.supportsThreads).toBe(true);
    expect(adapter.capabilities.maxMessageLength).toBe(4000);
  });

  it('has default no-op event handlers', async () => {
    const adapter = new SlackAdapter({
      botToken: 'xoxb-test',
      appToken: 'xapp-test',
      signingSecret: 'test-secret',
      mode: 'socket',
      port: 3210,
    });

    // Default handlers should not throw
    await adapter.onMessage({
      platform: 'slack',
      channelId: 'C1',
      conversationId: 'thread-1',
      messageId: 'msg-1',
      userId: 'U1',
      userName: 'alice',
      text: 'hello',
      timestamp: '12345.000',
      isBot: false,
    });

    await adapter.onReaction('C1', 'msg-1', 'U1', 'thumbsup');

    const result = await adapter.onCommand('C1', 'U1', 'help', '');
    expect(result).toBe('');
  });

  it('allows assigning custom event handlers', async () => {
    const adapter = new SlackAdapter({
      botToken: 'xoxb-test',
      appToken: 'xapp-test',
      signingSecret: 'test-secret',
      mode: 'socket',
      port: 3210,
    });

    let called = false;
    adapter.onMessage = async () => {
      called = true;
    };

    await adapter.onMessage({
      platform: 'slack',
      channelId: 'C1',
      conversationId: 'thread-1',
      messageId: 'msg-1',
      userId: 'U1',
      userName: 'alice',
      text: 'hello',
      timestamp: '12345.000',
      isBot: false,
    });

    expect(called).toBe(true);
  });
});
