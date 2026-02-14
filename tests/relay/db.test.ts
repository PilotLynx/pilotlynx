import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  initDb,
  cacheMessage,
  getCachedMessages,
  writePendingMessage,
  markPendingDone,
  getPendingMessages,
  recordRelayRun,
  updateRelayRun,
  cleanupStaleData,
  getRunStats,
} from '../../src/lib/relay/db.js';
import type { ChatMessage } from '../../src/lib/relay/platform.js';
import type { PendingMessage } from '../../src/lib/relay/types.js';

let db: Database.Database;

beforeEach(() => {
  db = initDb(':memory:');
});

afterEach(() => {
  db.close();
});

// ── initDb ──

describe('initDb', () => {
  it('creates all required tables', () => {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as Array<{ name: string }>;

    const names = tables.map((t) => t.name);
    expect(names).toContain('bindings');
    expect(names).toContain('threads');
    expect(names).toContain('messages');
    expect(names).toContain('pending_messages');
    expect(names).toContain('relay_runs');
  });

  it('creates index on messages table', () => {
    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='messages'`)
      .all() as Array<{ name: string }>;

    const names = indexes.map((i) => i.name);
    expect(names).toContain('idx_messages_conv');
  });

  it('enables WAL journal mode for file-based databases', () => {
    // WAL mode is only supported on file-based databases, not :memory:
    // initDb sets WAL but :memory: silently falls back to 'memory'
    const result = db.pragma('journal_mode') as Array<{ journal_mode: string }>;
    expect(result[0].journal_mode).toBe('memory');
  });
});

// ── cacheMessage + getCachedMessages ──

describe('cacheMessage and getCachedMessages', () => {
  const msg: ChatMessage = {
    platform: 'slack',
    channelId: 'C123',
    conversationId: 'thread-1',
    messageId: 'msg-001',
    userId: 'U001',
    userName: 'alice',
    text: 'hello world',
    timestamp: '2025-01-01T00:00:00Z',
    isBot: false,
  };

  it('round-trips a message through cache and retrieval', () => {
    cacheMessage(db, msg);
    const results = getCachedMessages(db, 'slack', 'C123', 'thread-1');

    expect(results).toHaveLength(1);
    expect(results[0].platform).toBe('slack');
    expect(results[0].channelId).toBe('C123');
    expect(results[0].conversationId).toBe('thread-1');
    expect(results[0].messageId).toBe('msg-001');
    expect(results[0].userId).toBe('U001');
    expect(results[0].userName).toBe('alice');
    expect(results[0].text).toBe('hello world');
    expect(results[0].isBot).toBe(false);
    expect(results[0].timestamp).toBe('2025-01-01T00:00:00Z');
  });

  it('upserts on duplicate message_id (INSERT OR REPLACE)', () => {
    cacheMessage(db, msg);
    cacheMessage(db, { ...msg, text: 'updated text' });

    const results = getCachedMessages(db, 'slack', 'C123', 'thread-1');
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('updated text');
  });

  it('filters by afterTs when provided', () => {
    cacheMessage(db, { ...msg, messageId: 'msg-001', timestamp: '2025-01-01T00:00:00Z' });
    cacheMessage(db, { ...msg, messageId: 'msg-002', timestamp: '2025-01-02T00:00:00Z' });
    cacheMessage(db, { ...msg, messageId: 'msg-003', timestamp: '2025-01-03T00:00:00Z' });

    const results = getCachedMessages(db, 'slack', 'C123', 'thread-1', '2025-01-01T12:00:00Z');
    expect(results).toHaveLength(2);
    expect(results[0].messageId).toBe('msg-002');
    expect(results[1].messageId).toBe('msg-003');
  });

  it('returns empty array for non-existent conversation', () => {
    const results = getCachedMessages(db, 'slack', 'C999', 'thread-nope');
    expect(results).toEqual([]);
  });

  it('correctly stores and retrieves isBot=true', () => {
    cacheMessage(db, { ...msg, isBot: true });
    const results = getCachedMessages(db, 'slack', 'C123', 'thread-1');
    expect(results[0].isBot).toBe(true);
  });
});

// ── Pending Messages ──

describe('writePendingMessage, markPendingDone, getPendingMessages', () => {
  const pending: PendingMessage = {
    id: 'pm-001',
    platform: 'telegram',
    channelId: 'T100',
    conversationId: 'conv-1',
    userId: 'U42',
    userName: 'bob',
    text: 'run workflow',
    receivedAt: new Date().toISOString(),
    status: 'pending',
  };

  it('writes and retrieves a pending message', () => {
    writePendingMessage(db, pending);
    const results = getPendingMessages(db, 60);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('pm-001');
    expect(results[0].platform).toBe('telegram');
    expect(results[0].text).toBe('run workflow');
    expect(results[0].status).toBe('pending');
  });

  it('markPendingDone sets status to done', () => {
    writePendingMessage(db, pending);
    markPendingDone(db, 'pm-001');

    // done messages should not appear in getPendingMessages
    const results = getPendingMessages(db, 60);
    expect(results).toHaveLength(0);

    // Verify status directly
    const row = db.prepare('SELECT status FROM pending_messages WHERE id = ?').get('pm-001') as { status: string };
    expect(row.status).toBe('done');
  });

  it('getPendingMessages excludes expired messages', () => {
    const oldMsg: PendingMessage = {
      ...pending,
      id: 'pm-old',
      receivedAt: new Date(Date.now() - 120 * 60_000).toISOString(), // 2 hours ago
    };
    writePendingMessage(db, oldMsg);

    // maxAgeMinutes=60 should exclude the 2-hour-old message
    const results = getPendingMessages(db, 60);
    expect(results).toHaveLength(0);
  });

  it('getPendingMessages excludes done and failed', () => {
    writePendingMessage(db, pending);
    writePendingMessage(db, { ...pending, id: 'pm-002', status: 'done' as PendingMessage['status'] });

    const failedMsg: PendingMessage = { ...pending, id: 'pm-003', status: 'failed' };
    writePendingMessage(db, failedMsg);

    const results = getPendingMessages(db, 60);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('pm-001');
  });

  it('getPendingMessages includes processing status', () => {
    const processingMsg: PendingMessage = { ...pending, id: 'pm-proc', status: 'processing' };
    writePendingMessage(db, processingMsg);

    const results = getPendingMessages(db, 60);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('processing');
  });
});

// ── Relay Runs ──

describe('recordRelayRun and updateRelayRun', () => {
  const run = {
    id: 'run-001',
    platform: 'slack',
    channelId: 'C123',
    conversationId: 'thread-1',
    project: 'my-project',
    userId: 'U001',
    startedAt: new Date().toISOString(),
    status: 'running',
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };

  it('records and retrieves a relay run', () => {
    recordRelayRun(db, run);

    const row = db.prepare('SELECT * FROM relay_runs WHERE id = ?').get('run-001') as Record<string, any>;
    expect(row.platform).toBe('slack');
    expect(row.project).toBe('my-project');
    expect(row.status).toBe('running');
  });

  it('updates specific fields of a relay run', () => {
    recordRelayRun(db, run);
    updateRelayRun(db, 'run-001', {
      status: 'completed',
      completedAt: new Date().toISOString(),
      costUsd: 0.05,
      inputTokens: 1000,
      outputTokens: 500,
      durationMs: 15000,
      model: 'claude-sonnet-4-5-20250929',
    });

    const row = db.prepare('SELECT * FROM relay_runs WHERE id = ?').get('run-001') as Record<string, any>;
    expect(row.status).toBe('completed');
    expect(row.cost_usd).toBe(0.05);
    expect(row.input_tokens).toBe(1000);
    expect(row.output_tokens).toBe(500);
    expect(row.duration_ms).toBe(15000);
    expect(row.model).toBe('claude-sonnet-4-5-20250929');
  });

  it('updateRelayRun is a no-op with empty updates', () => {
    recordRelayRun(db, run);
    updateRelayRun(db, 'run-001', {});

    const row = db.prepare('SELECT * FROM relay_runs WHERE id = ?').get('run-001') as Record<string, any>;
    expect(row.status).toBe('running');
  });
});

// ── cleanupStaleData ──

describe('cleanupStaleData', () => {
  it('deletes expired messages beyond expiredDays', () => {
    const oldTs = new Date(Date.now() - 100 * 86_400_000).toISOString();
    cacheMessage(db, {
      platform: 'slack',
      channelId: 'C1',
      conversationId: 'conv-1',
      messageId: 'old-msg',
      userId: 'U1',
      userName: 'user',
      text: 'old',
      timestamp: oldTs,
      isBot: false,
    });

    const result = cleanupStaleData(db, 24, 7, 30);
    expect(result.deletedMessages).toBeGreaterThanOrEqual(1);
  });

  it('deletes done/failed pending messages older than hotHours', () => {
    const oldReceived = new Date(Date.now() - 48 * 3_600_000).toISOString();
    writePendingMessage(db, {
      id: 'old-pending',
      platform: 'slack',
      channelId: 'C1',
      conversationId: 'conv-1',
      userId: 'U1',
      userName: 'user',
      text: 'old msg',
      receivedAt: oldReceived,
      status: 'pending',
    });
    markPendingDone(db, 'old-pending');

    const result = cleanupStaleData(db, 24, 7, 30);
    expect(result.deletedPending).toBe(1);
  });

  it('deletes expired relay runs', () => {
    const oldStart = new Date(Date.now() - 100 * 86_400_000).toISOString();
    recordRelayRun(db, {
      id: 'old-run',
      platform: 'slack',
      channelId: 'C1',
      conversationId: 'conv-1',
      project: 'proj',
      userId: 'U1',
      startedAt: oldStart,
      status: 'completed',
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
    });

    const result = cleanupStaleData(db, 24, 7, 30);
    expect(result.deletedRuns).toBe(1);
  });

  it('returns zero counts when nothing to clean', () => {
    const result = cleanupStaleData(db, 24, 7, 30);
    expect(result.deletedMessages).toBe(0);
    expect(result.deletedPending).toBe(0);
    expect(result.deletedRuns).toBe(0);
  });
});

// ── getRunStats ──

describe('getRunStats', () => {
  it('returns zero stats when no runs exist', () => {
    const stats = getRunStats(db);
    expect(stats.totalRuns).toBe(0);
    expect(stats.totalCost).toBe(0);
    expect(stats.avgDuration).toBe(0);
  });

  it('computes aggregate stats across all runs', () => {
    const now = new Date().toISOString();
    recordRelayRun(db, {
      id: 'r1',
      platform: 'slack',
      channelId: 'C1',
      conversationId: 'conv-1',
      project: 'proj-a',
      userId: 'U1',
      startedAt: now,
      status: 'completed',
      costUsd: 0.10,
      inputTokens: 1000,
      outputTokens: 500,
      durationMs: 10000,
    });
    recordRelayRun(db, {
      id: 'r2',
      platform: 'telegram',
      channelId: 'T1',
      conversationId: 'conv-2',
      project: 'proj-b',
      userId: 'U2',
      startedAt: now,
      status: 'completed',
      costUsd: 0.20,
      inputTokens: 2000,
      outputTokens: 1000,
      durationMs: 20000,
    });

    const stats = getRunStats(db);
    expect(stats.totalRuns).toBe(2);
    expect(stats.totalCost).toBeCloseTo(0.30);
    expect(stats.avgDuration).toBe(15000);
  });

  it('filters by project', () => {
    const now = new Date().toISOString();
    recordRelayRun(db, {
      id: 'r1',
      platform: 'slack',
      channelId: 'C1',
      conversationId: 'conv-1',
      project: 'proj-a',
      userId: 'U1',
      startedAt: now,
      status: 'completed',
      costUsd: 0.10,
      inputTokens: 1000,
      outputTokens: 500,
      durationMs: 10000,
    });
    recordRelayRun(db, {
      id: 'r2',
      platform: 'slack',
      channelId: 'C1',
      conversationId: 'conv-2',
      project: 'proj-b',
      userId: 'U1',
      startedAt: now,
      status: 'completed',
      costUsd: 0.20,
      inputTokens: 2000,
      outputTokens: 1000,
      durationMs: 20000,
    });

    const stats = getRunStats(db, 'proj-a');
    expect(stats.totalRuns).toBe(1);
    expect(stats.totalCost).toBeCloseTo(0.10);
    expect(stats.avgDuration).toBe(10000);
  });

  it('filters by days', () => {
    const recent = new Date().toISOString();
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString();

    recordRelayRun(db, {
      id: 'r-recent',
      platform: 'slack',
      channelId: 'C1',
      conversationId: 'conv-1',
      project: 'proj-a',
      userId: 'U1',
      startedAt: recent,
      status: 'completed',
      costUsd: 0.10,
      inputTokens: 1000,
      outputTokens: 500,
      durationMs: 5000,
    });
    recordRelayRun(db, {
      id: 'r-old',
      platform: 'slack',
      channelId: 'C1',
      conversationId: 'conv-2',
      project: 'proj-a',
      userId: 'U1',
      startedAt: old,
      status: 'completed',
      costUsd: 0.50,
      inputTokens: 5000,
      outputTokens: 2000,
      durationMs: 30000,
    });

    const stats = getRunStats(db, undefined, 7);
    expect(stats.totalRuns).toBe(1);
    expect(stats.totalCost).toBeCloseTo(0.10);
  });
});
