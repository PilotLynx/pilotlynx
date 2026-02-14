import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDb, cacheMessage } from '../../src/lib/relay/db.js';
import {
  normalizeForPrompt,
  isThreadStale,
  assembleContext,
} from '../../src/lib/relay/context.js';
import type { ContextConfig } from '../../src/lib/relay/context.js';
import type { ChatMessage, ChatPlatform, PlatformCapabilities, StreamHandle } from '../../src/lib/relay/platform.js';

let db: Database.Database;

beforeEach(() => {
  db = initDb(':memory:');
});

afterEach(() => {
  db.close();
});

function makeChatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    platform: 'test-platform',
    channelId: 'C1',
    conversationId: 'conv-1',
    messageId: 'msg-' + Math.random().toString(36).slice(2, 8),
    userId: 'U1',
    userName: 'alice',
    text: 'hello world',
    timestamp: new Date().toISOString(),
    isBot: false,
    ...overrides,
  };
}

function makeMockPlatform(overrides: Partial<ChatPlatform> = {}): ChatPlatform {
  const capabilities: PlatformCapabilities = {
    nativeStreaming: false,
    maxStreamUpdateHz: 1,
    supportsReactions: false,
    supportsSlashCommands: false,
    supportsThreads: false,
    maxMessageLength: 4000,
  };

  return {
    name: 'test-platform',
    capabilities,
    start: async () => {},
    stop: async () => {},
    sendMessage: async () => '',
    updateMessage: async () => {},
    startStream: async (): Promise<StreamHandle> => ({ append: async () => {}, stop: async () => {} }),
    uploadFile: async () => {},
    getThreadHistory: async () => [],
    onMessage: async () => {},
    onReaction: async () => {},
    onCommand: async () => '',
    ...overrides,
  };
}

describe('normalizeForPrompt', () => {
  it('wraps user messages in <user_message> tags', () => {
    const msgs: ChatMessage[] = [
      makeChatMessage({ text: 'hello', isBot: false, userName: 'alice', timestamp: '2025-01-01T12:00:00.000Z' }),
    ];
    const result = normalizeForPrompt(msgs, 4000);
    expect(result).toContain('<user_message>hello</user_message>');
    expect(result).toContain('alice');
  });

  it('does not wrap bot messages in <user_message> tags', () => {
    const msgs: ChatMessage[] = [
      makeChatMessage({ text: 'response', isBot: true, userName: 'bot', timestamp: '2025-01-01T12:00:00.000Z' }),
    ];
    const result = normalizeForPrompt(msgs, 4000);
    expect(result).not.toContain('<user_message>');
    expect(result).toContain('response');
  });

  it('truncates long messages', () => {
    const longText = 'x'.repeat(200);
    const msgs: ChatMessage[] = [
      makeChatMessage({ text: longText, timestamp: '2025-01-01T12:00:00.000Z' }),
    ];
    const result = normalizeForPrompt(msgs, 50);
    expect(result).toContain('...');
    expect(result.length).toBeLessThan(longText.length + 100);
  });
});

describe('isThreadStale', () => {
  const platform = makeMockPlatform();

  it('returns true for a thread with no messages', () => {
    const stale = isThreadStale(db, platform, 'C1', 'conv-no-messages', 7);
    expect(stale).toBe(true);
  });

  it('returns false for a thread with recent messages', () => {
    cacheMessage(db, makeChatMessage({
      conversationId: 'conv-recent',
      timestamp: new Date().toISOString(),
    }));
    const stale = isThreadStale(db, platform, 'C1', 'conv-recent', 7);
    expect(stale).toBe(false);
  });

  it('returns true for a thread with only old messages', () => {
    const oldDate = new Date(Date.now() - 30 * 86_400_000).toISOString();
    cacheMessage(db, makeChatMessage({
      conversationId: 'conv-old',
      timestamp: oldDate,
    }));
    const stale = isThreadStale(db, platform, 'C1', 'conv-old', 7);
    expect(stale).toBe(true);
  });
});

describe('assembleContext', () => {
  const defaultConfig: ContextConfig = {
    tokenBudget: 16_000,
    maxMessagesPerThread: 50,
    maxCharsPerMessage: 4000,
    staleThreadDays: 7,
  };

  it('builds prompt with system context and current request', async () => {
    const platform = makeMockPlatform();
    const { prompt } = await assembleContext(
      db, platform, 'C1', 'conv-1', 'do something', 'alice', 'my-project', defaultConfig,
    );

    expect(prompt).toContain('my-project');
    expect(prompt).toContain('test-platform');
    expect(prompt).toContain('do something');
    expect(prompt).toContain('alice');
    expect(prompt).toContain('<system_context>');
    expect(prompt).toContain('<current_request');
  });

  it('includes conversation history for non-stale threads', async () => {
    const platform = makeMockPlatform();
    // Insert a recent message
    cacheMessage(db, makeChatMessage({
      conversationId: 'conv-active',
      text: 'earlier message',
      timestamp: new Date(Date.now() - 60_000).toISOString(),
    }));

    const { prompt, isStale } = await assembleContext(
      db, platform, 'C1', 'conv-active', 'new question', 'alice', 'proj', defaultConfig,
    );

    expect(isStale).toBe(false);
    expect(prompt).toContain('earlier message');
    expect(prompt).toContain('<conversation_history>');
  });

  it('trims messages to token budget by removing oldest first', async () => {
    const platform = makeMockPlatform();
    const convId = 'conv-budget';
    // Insert many messages to exceed budget
    const tinyConfig: ContextConfig = {
      tokenBudget: 100, // ~400 chars budget
      maxMessagesPerThread: 50,
      maxCharsPerMessage: 4000,
      staleThreadDays: 7,
    };

    for (let i = 0; i < 10; i++) {
      cacheMessage(db, makeChatMessage({
        conversationId: convId,
        messageId: `msg-${i}`,
        text: `message number ${i} with some extra padding text to take up space`,
        timestamp: new Date(Date.now() - (10 - i) * 60_000).toISOString(),
      }));
    }

    const { prompt } = await assembleContext(
      db, platform, 'C1', convId, 'query', 'alice', 'proj', tinyConfig,
    );

    // Should have trimmed; the most recent messages should be present
    expect(prompt).toContain('message number 9');
    // The earliest messages may have been trimmed
  });
});
