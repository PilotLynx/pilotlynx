import type Database from 'better-sqlite3';
import type { BindingRecord } from './types.js';

export function saveBinding(
  db: Database.Database,
  platform: string,
  channelId: string,
  project: string,
  userId: string,
): void {
  db.prepare(`
    INSERT OR REPLACE INTO bindings (platform, channel_id, project, bound_by, bound_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(platform, channelId, project, userId, new Date().toISOString());
}

export function removeBinding(
  db: Database.Database,
  platform: string,
  channelId: string,
): boolean {
  const result = db.prepare(`
    DELETE FROM bindings WHERE platform = ? AND channel_id = ?
  `).run(platform, channelId);
  return result.changes > 0;
}

export function lookupBinding(
  db: Database.Database,
  platform: string,
  channelId: string,
): string | null {
  const row = db.prepare(`
    SELECT project FROM bindings WHERE platform = ? AND channel_id = ?
  `).get(platform, channelId) as { project: string } | undefined;
  return row?.project ?? null;
}

export function getBindingsForPlatform(
  db: Database.Database,
  platform: string,
): BindingRecord[] {
  const rows = db.prepare(`
    SELECT platform, channel_id, project, bound_by, bound_at, config_json
    FROM bindings WHERE platform = ?
  `).all(platform) as Array<{
    platform: string;
    channel_id: string;
    project: string;
    bound_by: string;
    bound_at: string;
    config_json: string | null;
  }>;

  return rows.map(toBindingRecord);
}

export function getAllBindings(db: Database.Database): BindingRecord[] {
  const rows = db.prepare(`
    SELECT platform, channel_id, project, bound_by, bound_at, config_json
    FROM bindings
  `).all() as Array<{
    platform: string;
    channel_id: string;
    project: string;
    bound_by: string;
    bound_at: string;
    config_json: string | null;
  }>;

  return rows.map(toBindingRecord);
}

export function getChannelForProject(
  db: Database.Database,
  platform: string,
  project: string,
): string | null {
  const row = db.prepare(`
    SELECT channel_id FROM bindings WHERE platform = ? AND project = ?
  `).get(platform, project) as { channel_id: string } | undefined;
  return row?.channel_id ?? null;
}

// ── Helpers ──

function toBindingRecord(r: {
  platform: string;
  channel_id: string;
  project: string;
  bound_by: string;
  bound_at: string;
  config_json: string | null;
}): BindingRecord {
  return {
    platform: r.platform,
    channelId: r.channel_id,
    project: r.project,
    boundBy: r.bound_by,
    boundAt: r.bound_at,
    configJson: r.config_json ?? undefined,
  };
}
