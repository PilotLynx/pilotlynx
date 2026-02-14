import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../src/lib/config.js';
import { resetPolicyCache } from '../../src/lib/policy.js';
import { resetRegistryCache } from '../../src/lib/registry.js';
import {
  classifyReaction,
  handleFeedback,
  appendRelayFeedback,
  readRelayFeedback,
  isReactionRateLimited,
} from '../../src/lib/relay/feedback.js';
import type { FeedbackSignal } from '../../src/lib/relay/platform.js';

let tmpDir: string;
let configDir: string;

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
});

afterEach(() => {
  delete process.env.PILOTLYNX_ROOT;
  rmSync(tmpDir, { recursive: true, force: true });
  resetConfigCache();
  resetPolicyCache();
  resetRegistryCache();
});

describe('classifyReaction', () => {
  it('maps thumbsup to positive', () => {
    expect(classifyReaction('thumbsup')).toBe('positive');
    expect(classifyReaction('+1')).toBe('positive');
  });

  it('maps thumbsdown to negative', () => {
    expect(classifyReaction('thumbsdown')).toBe('negative');
    expect(classifyReaction('-1')).toBe('negative');
  });

  it('maps star to save', () => {
    expect(classifyReaction('star')).toBe('save');
    expect(classifyReaction('glowing_star')).toBe('save');
  });

  it('maps eyes to acknowledge', () => {
    expect(classifyReaction('eyes')).toBe('acknowledge');
  });

  it('returns null for unknown emoji', () => {
    expect(classifyReaction('pizza')).toBeNull();
    expect(classifyReaction('rocket')).toBeNull();
  });

  it('strips colons from emoji names', () => {
    expect(classifyReaction(':thumbsup:')).toBe('positive');
  });
});

describe('handleFeedback', () => {
  it('creates correct feedback entry from signal', () => {
    const signal: FeedbackSignal = {
      type: 'positive',
      platform: 'slack',
      conversationId: 'conv-1',
      messageId: 'msg-1',
      userId: 'U1',
      userName: 'alice',
      timestamp: '2025-01-01T12:00:00Z',
    };

    const entry = handleFeedback(signal, 'my-project', 'Agent said hello');
    expect(entry.type).toBe('positive');
    expect(entry.platform).toBe('slack');
    expect(entry.project).toBe('my-project');
    expect(entry.agentOutputSummary).toBe('Agent said hello');
    expect(entry.userId).toBe('U1');
    expect(entry.conversationId).toBe('conv-1');
  });
});

describe('appendRelayFeedback and readRelayFeedback', () => {
  it('writes and reads back feedback entries as JSONL', () => {
    const entry = {
      type: 'positive' as const,
      platform: 'slack',
      conversationId: 'conv-1',
      messageId: 'msg-1',
      userId: 'U1',
      userName: 'alice',
      timestamp: '2025-01-01T12:00:00Z',
      project: 'proj-a',
    };

    appendRelayFeedback(entry);
    appendRelayFeedback({
      ...entry,
      type: 'negative',
      project: 'proj-b',
      messageId: 'msg-2',
    });

    const all = readRelayFeedback();
    expect(all).toHaveLength(2);
    expect(all[0].type).toBe('positive');
    expect(all[1].type).toBe('negative');
  });

  it('filters by project when reading', () => {
    appendRelayFeedback({
      type: 'positive',
      platform: 'slack',
      conversationId: 'conv-1',
      messageId: 'msg-1',
      userId: 'U1',
      userName: 'alice',
      timestamp: '2025-01-01T12:00:00Z',
      project: 'proj-a',
    });
    appendRelayFeedback({
      type: 'negative',
      platform: 'slack',
      conversationId: 'conv-1',
      messageId: 'msg-2',
      userId: 'U1',
      userName: 'alice',
      timestamp: '2025-01-01T12:00:00Z',
      project: 'proj-b',
    });

    const filtered = readRelayFeedback('proj-a');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].project).toBe('proj-a');
  });

  it('returns empty array when no feedback file exists', () => {
    const result = readRelayFeedback();
    expect(result).toEqual([]);
  });
});

describe('isReactionRateLimited', () => {
  it('allows reactions under the limit', () => {
    // Use a unique user ID to avoid cross-test state
    const userId = 'rate-test-' + Math.random().toString(36).slice(2);
    expect(isReactionRateLimited(userId, 5)).toBe(false);
    expect(isReactionRateLimited(userId, 5)).toBe(false);
    expect(isReactionRateLimited(userId, 5)).toBe(false);
  });

  it('blocks reactions over the limit', () => {
    const userId = 'rate-block-' + Math.random().toString(36).slice(2);
    // Exhaust the limit
    for (let i = 0; i < 3; i++) {
      isReactionRateLimited(userId, 3);
    }
    // The 4th call should be rate limited
    expect(isReactionRateLimited(userId, 3)).toBe(true);
  });
});
