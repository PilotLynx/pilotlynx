import Database from 'better-sqlite3';
import type { ChatMessage } from './platform.js';
import type { PendingMessage } from './types.js';

// ── Database Initialization ──

export function initDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('wal_autocheckpoint = 1000');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS bindings (
      platform TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      project TEXT NOT NULL,
      bound_by TEXT NOT NULL,
      bound_at TEXT NOT NULL,
      config_json TEXT,
      PRIMARY KEY (platform, channel_id)
    );

    CREATE TABLE IF NOT EXISTS threads (
      platform TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      project TEXT NOT NULL,
      last_seen_ts TEXT NOT NULL,
      message_count INTEGER DEFAULT 0,
      summary TEXT,
      PRIMARY KEY (platform, channel_id, conversation_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      platform TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      content TEXT NOT NULL,
      is_bot INTEGER NOT NULL DEFAULT 0,
      timestamp TEXT NOT NULL,
      PRIMARY KEY (platform, channel_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conv
      ON messages(platform, channel_id, conversation_id, timestamp);

    CREATE TABLE IF NOT EXISTS pending_messages (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      text TEXT NOT NULL,
      received_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS relay_runs (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      project TEXT NOT NULL,
      user_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      cost_usd REAL DEFAULT 0,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      model TEXT
    );
  `);

  return db;
}

// ── Message Cache ──

export function cacheMessage(db: Database.Database, msg: ChatMessage): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO messages
      (platform, channel_id, conversation_id, message_id, user_id, user_name, content, is_bot, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    msg.platform,
    msg.channelId,
    msg.conversationId,
    msg.messageId,
    msg.userId,
    msg.userName,
    msg.text,
    msg.isBot ? 1 : 0,
    msg.timestamp,
  );
}

export function getCachedMessages(
  db: Database.Database,
  platform: string,
  channelId: string,
  conversationId: string,
  afterTs?: string,
): ChatMessage[] {
  const sql = afterTs
    ? `SELECT * FROM messages
       WHERE platform = ? AND channel_id = ? AND conversation_id = ? AND timestamp > ?
       ORDER BY timestamp ASC`
    : `SELECT * FROM messages
       WHERE platform = ? AND channel_id = ? AND conversation_id = ?
       ORDER BY timestamp ASC`;

  const params = afterTs
    ? [platform, channelId, conversationId, afterTs]
    : [platform, channelId, conversationId];

  const rows = db.prepare(sql).all(...params) as Array<{
    platform: string;
    channel_id: string;
    conversation_id: string;
    message_id: string;
    user_id: string;
    user_name: string;
    content: string;
    is_bot: number;
    timestamp: string;
  }>;

  return rows.map((r) => ({
    platform: r.platform,
    channelId: r.channel_id,
    conversationId: r.conversation_id,
    messageId: r.message_id,
    userId: r.user_id,
    userName: r.user_name,
    text: r.content,
    isBot: r.is_bot === 1,
    timestamp: r.timestamp,
  }));
}

// ── Pending Messages (WAL) ──

export function writePendingMessage(db: Database.Database, msg: PendingMessage): void {
  const stmt = db.prepare(`
    INSERT INTO pending_messages
      (id, platform, channel_id, conversation_id, user_id, user_name, text, received_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    msg.id,
    msg.platform,
    msg.channelId,
    msg.conversationId,
    msg.userId,
    msg.userName,
    msg.text,
    msg.receivedAt,
    msg.status,
  );
}

export function markPendingDone(db: Database.Database, id: string): void {
  db.prepare(`UPDATE pending_messages SET status = 'done' WHERE id = ?`).run(id);
}

export function getPendingMessages(
  db: Database.Database,
  maxAgeMinutes: number,
): PendingMessage[] {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000).toISOString();
  const rows = db.prepare(`
    SELECT * FROM pending_messages
    WHERE status IN ('pending', 'processing') AND received_at >= ?
    ORDER BY received_at ASC
  `).all(cutoff) as Array<{
    id: string;
    platform: string;
    channel_id: string;
    conversation_id: string;
    user_id: string;
    user_name: string;
    text: string;
    received_at: string;
    status: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    channelId: r.channel_id,
    conversationId: r.conversation_id,
    userId: r.user_id,
    userName: r.user_name,
    text: r.text,
    receivedAt: r.received_at,
    status: r.status as PendingMessage['status'],
  }));
}

// ── Relay Runs ──

export interface RelayRunRow {
  id: string;
  platform: string;
  channelId: string;
  conversationId: string;
  project: string;
  userId: string;
  startedAt: string;
  completedAt?: string;
  status: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  model?: string;
}

export function recordRelayRun(db: Database.Database, run: RelayRunRow): void {
  const stmt = db.prepare(`
    INSERT INTO relay_runs
      (id, platform, channel_id, conversation_id, project, user_id, started_at, completed_at, status,
       cost_usd, input_tokens, output_tokens, duration_ms, model)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    run.id,
    run.platform,
    run.channelId,
    run.conversationId,
    run.project,
    run.userId,
    run.startedAt,
    run.completedAt ?? null,
    run.status,
    run.costUsd,
    run.inputTokens,
    run.outputTokens,
    run.durationMs,
    run.model ?? null,
  );
}

export function updateRelayRun(
  db: Database.Database,
  id: string,
  updates: Partial<Pick<RelayRunRow, 'completedAt' | 'status' | 'costUsd' | 'inputTokens' | 'outputTokens' | 'durationMs' | 'model'>>,
): void {
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (updates.completedAt !== undefined) {
    setClauses.push('completed_at = ?');
    params.push(updates.completedAt);
  }
  if (updates.status !== undefined) {
    setClauses.push('status = ?');
    params.push(updates.status);
  }
  if (updates.costUsd !== undefined) {
    setClauses.push('cost_usd = ?');
    params.push(updates.costUsd);
  }
  if (updates.inputTokens !== undefined) {
    setClauses.push('input_tokens = ?');
    params.push(updates.inputTokens);
  }
  if (updates.outputTokens !== undefined) {
    setClauses.push('output_tokens = ?');
    params.push(updates.outputTokens);
  }
  if (updates.durationMs !== undefined) {
    setClauses.push('duration_ms = ?');
    params.push(updates.durationMs);
  }
  if (updates.model !== undefined) {
    setClauses.push('model = ?');
    params.push(updates.model);
  }

  if (setClauses.length === 0) return;

  params.push(id);
  db.prepare(`UPDATE relay_runs SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
}

// ── Cleanup (Two-Tier TTL) ──

export function cleanupStaleData(
  db: Database.Database,
  hotHours: number,
  coldDays: number,
  expiredDays: number,
): { deletedMessages: number; deletedPending: number; deletedRuns: number } {
  const now = Date.now();
  const coldCutoff = new Date(now - coldDays * 86_400_000).toISOString();
  const expiredCutoff = new Date(now - expiredDays * 86_400_000).toISOString();

  // Delete expired messages (beyond expiredDays)
  const msgResult = db.prepare(`
    DELETE FROM messages WHERE timestamp < ?
  `).run(expiredCutoff);

  // For cold zone (between coldDays and expiredDays), keep only last 10 messages per conversation
  // by deleting older messages beyond the 10 most recent
  db.prepare(`
    DELETE FROM messages
    WHERE rowid IN (
      SELECT m.rowid FROM messages m
      WHERE m.timestamp < ? AND m.timestamp >= ?
        AND m.rowid NOT IN (
          SELECT m2.rowid FROM messages m2
          WHERE m2.platform = m.platform
            AND m2.channel_id = m.channel_id
            AND m2.conversation_id = m.conversation_id
          ORDER BY m2.timestamp DESC
          LIMIT 10
        )
    )
  `).run(coldCutoff, expiredCutoff);

  // Delete completed/failed pending messages older than hotHours
  const hotCutoff = new Date(now - hotHours * 3_600_000).toISOString();
  const pendingResult = db.prepare(`
    DELETE FROM pending_messages WHERE status IN ('done', 'failed') AND received_at < ?
  `).run(hotCutoff);

  // Delete expired relay_runs
  const runResult = db.prepare(`
    DELETE FROM relay_runs WHERE started_at < ?
  `).run(expiredCutoff);

  return {
    deletedMessages: msgResult.changes,
    deletedPending: pendingResult.changes,
    deletedRuns: runResult.changes,
  };
}

// ── Stats ──

export interface RunStats {
  totalRuns: number;
  totalCost: number;
  avgDuration: number;
}

export function getRunStats(
  db: Database.Database,
  project?: string,
  days?: number,
): RunStats {
  let sql = `
    SELECT
      COUNT(*) as total_runs,
      COALESCE(SUM(cost_usd), 0) as total_cost,
      COALESCE(AVG(duration_ms), 0) as avg_duration
    FROM relay_runs
    WHERE 1=1
  `;
  const params: unknown[] = [];

  if (project) {
    sql += ' AND project = ?';
    params.push(project);
  }
  if (days) {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    sql += ' AND started_at >= ?';
    params.push(cutoff);
  }

  const row = db.prepare(sql).get(...params) as {
    total_runs: number;
    total_cost: number;
    avg_duration: number;
  };

  return {
    totalRuns: row.total_runs,
    totalCost: row.total_cost,
    avgDuration: row.avg_duration,
  };
}
