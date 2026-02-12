import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectDir, INSIGHTS_DIR } from './config.js';
import type { RunRecord } from './types.js';

export function getRecentLogs(project: string, days: number): RunRecord[] {
  const logsDir = join(getProjectDir(project), 'logs');
  if (!existsSync(logsDir)) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffMs = cutoff.getTime();

  const files = readdirSync(logsDir).filter((f) => f.endsWith('.json'));
  const records: RunRecord[] = [];
  let corruptCount = 0;

  for (const file of files) {
    try {
      const content = readFileSync(join(logsDir, file), 'utf8');
      const record = JSON.parse(content) as RunRecord;
      if (new Date(record.startedAt).getTime() >= cutoffMs) {
        records.push(record);
      }
    } catch {
      corruptCount++;
    }
  }

  if (corruptCount > 0) {
    console.warn(
      `[plynx] Warning: ${corruptCount} log entr${corruptCount === 1 ? 'y' : 'ies'} in "${project}" could not be parsed`
    );
  }

  records.sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  );

  return records;
}

export function writeInsight(content: string): void {
  const dir = INSIGHTS_DIR();
  mkdirSync(dir, { recursive: true });

  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const filename = `${y}-${mo}-${d}.md`;
  const filePath = join(dir, filename);

  if (existsSync(filePath)) {
    appendFileSync(filePath, `\n${content}`, 'utf8');
  } else {
    writeFileSync(filePath, content, 'utf8');
  }
}
