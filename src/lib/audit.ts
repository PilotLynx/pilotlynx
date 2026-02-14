import { existsSync, readFileSync, mkdirSync, readdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectDir } from './config.js';
import type { AuditEntry } from './types.js';

export function writeAuditEntry(project: string, entry: AuditEntry): void {
  const auditDir = join(getProjectDir(project), 'logs', 'audit');
  mkdirSync(auditDir, { recursive: true });

  const dateStr = entry.timestamp.split('T')[0];
  const filePath = join(auditDir, `${dateStr}.jsonl`);

  const line = JSON.stringify(entry) + '\n';

  // Append to daily JSONL file
  appendFileSync(filePath, line, 'utf8');
}

export function readAuditEntries(
  project: string,
  options?: { days?: number; workflow?: string },
): AuditEntry[] {
  const auditDir = join(getProjectDir(project), 'logs', 'audit');
  if (!existsSync(auditDir)) return [];

  const days = options?.days ?? 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const files = readdirSync(auditDir)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .reverse();

  const entries: AuditEntry[] = [];

  for (const file of files) {
    // Quick date check from filename (YYYY-MM-DD.jsonl)
    const fileDate = file.replace('.jsonl', '');
    if (new Date(fileDate) < cutoff) break;

    const lines = readFileSync(join(auditDir, file), 'utf8')
      .split('\n')
      .filter(l => l.trim());

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as AuditEntry;
        if (options?.workflow && entry.workflow !== options.workflow) continue;
        entries.push(entry);
      } catch {
        // Skip corrupt lines
      }
    }
  }

  return entries;
}

export function formatAuditCSV(entries: AuditEntry[]): string {
  const header = 'timestamp,project,workflow,triggeredBy,runId,success,costUsd,durationMs,model,toolInvocations';
  const rows = entries.map(e => [
    e.timestamp,
    e.project,
    e.workflow,
    e.triggeredBy,
    e.runId,
    e.success,
    e.costUsd.toFixed(4),
    e.durationMs,
    e.model ?? '',
    `"${e.toolInvocations.join(';')}"`,
  ].join(','));

  return [header, ...rows].join('\n');
}
