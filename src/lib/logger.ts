import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectDir } from './config.js';
import { sanitizeForFilename } from './validation.js';
import type { RunRecord } from './types.js';

function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${y}${mo}${d}-${h}${mi}${s}-${ms}`;
}

export function writeRunLog(project: string, record: RunRecord): void {
  const logsDir = join(getProjectDir(project), 'logs');
  mkdirSync(logsDir, { recursive: true });

  const timestamp = formatTimestamp(new Date(record.startedAt));
  const random = Math.random().toString(36).substring(2, 8);
  const filename = `${sanitizeForFilename(record.workflow)}_${timestamp}_${random}.json`;
  const filePath = join(logsDir, filename);
  const tmpPath = `${filePath}.tmp`;

  writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf8');
  renameSync(tmpPath, filePath);
}
