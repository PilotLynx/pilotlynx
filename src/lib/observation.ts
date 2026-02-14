import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectDir, INSIGHTS_DIR, SHARED_DOCS_DIR } from './config.js';
import type { RunRecord } from './types.js';

// ── Log Statistics ──

export interface LogStatistics {
  totalRuns: number;
  successCount: number;
  failureCount: number;
  failureRate: number;
  avgCostUsd: number;
  totalCostUsd: number;
  avgTurns: number;
  avgDurationMs: number;
  topWorkflows: Array<{ workflow: string; count: number; failureRate: number }>;
  topErrors: string[];
}

export function getLogStatistics(project: string, days: number): LogStatistics {
  const logs = getRecentLogs(project, days);

  if (logs.length === 0) {
    return {
      totalRuns: 0,
      successCount: 0,
      failureCount: 0,
      failureRate: 0,
      avgCostUsd: 0,
      totalCostUsd: 0,
      avgTurns: 0,
      avgDurationMs: 0,
      topWorkflows: [],
      topErrors: [],
    };
  }

  const successCount = logs.filter((l) => l.success).length;
  const failureCount = logs.length - successCount;
  const totalCostUsd = logs.reduce((sum, l) => sum + (l.costUsd ?? 0), 0);
  const avgTurns = logs.reduce((sum, l) => sum + (l.numTurns ?? 0), 0) / logs.length;

  // Compute average duration from startedAt/completedAt
  const durations = logs.map((l) => {
    const start = new Date(l.startedAt).getTime();
    const end = new Date(l.completedAt).getTime();
    return end - start;
  });
  const avgDurationMs = durations.reduce((sum, d) => sum + d, 0) / durations.length;

  // Workflow breakdown
  const workflowMap = new Map<string, { total: number; failures: number }>();
  for (const log of logs) {
    const entry = workflowMap.get(log.workflow) ?? { total: 0, failures: 0 };
    entry.total++;
    if (!log.success) entry.failures++;
    workflowMap.set(log.workflow, entry);
  }
  const topWorkflows = [...workflowMap.entries()]
    .map(([workflow, { total, failures }]) => ({
      workflow,
      count: total,
      failureRate: total > 0 ? failures / total : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Top error messages (deduplicated)
  const errors = logs
    .filter((l) => !l.success && l.error)
    .map((l) => l.error!);
  const errorCounts = new Map<string, number>();
  for (const err of errors) {
    const key = err.slice(0, 100); // Truncate for dedup
    errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
  }
  const topErrors = [...errorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([err, count]) => `${err} (×${count})`);

  return {
    totalRuns: logs.length,
    successCount,
    failureCount,
    failureRate: failureCount / logs.length,
    avgCostUsd: totalCostUsd / logs.length,
    totalCostUsd,
    avgTurns,
    avgDurationMs,
    topWorkflows,
    topErrors,
  };
}

// ── Log Reading ──

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
      `[pilotlynx] Warning: ${corruptCount} log entr${corruptCount === 1 ? 'y' : 'ies'} in "${project}" could not be parsed`
    );
  }

  records.sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  );

  return records;
}

// ── Insights ──

export interface StructuredInsight {
  id: string;
  category: string;
  insight: string;
  actionable: boolean;
  evidence: string;
  supersedes?: string;
  date: string;
}

export function writeInsight(content: string): void {
  const dir = INSIGHTS_DIR();
  mkdirSync(dir, { recursive: true });

  const now = new Date();
  const dateStr = formatDate(now);
  const filename = `${dateStr}.md`;
  const filePath = join(dir, filename);

  if (existsSync(filePath)) {
    appendFileSync(filePath, `\n${content}`, 'utf8');
  } else {
    writeFileSync(filePath, content, 'utf8');
  }
}

export function writeStructuredInsights(insights: StructuredInsight[]): void {
  if (insights.length === 0) return;

  const dir = INSIGHTS_DIR();
  mkdirSync(dir, { recursive: true });

  const now = new Date();
  const dateStr = formatDate(now);
  const jsonPath = join(dir, `${dateStr}.json`);

  let existing: StructuredInsight[] = [];
  if (existsSync(jsonPath)) {
    try {
      existing = JSON.parse(readFileSync(jsonPath, 'utf8'));
    } catch {
      // Corrupt file, overwrite
    }
  }

  const merged = [...existing, ...insights];
  writeFileSync(jsonPath, JSON.stringify(merged, null, 2), 'utf8');

  // Also write human-readable markdown
  const markdown = insights
    .map((i) => `### [${i.category}] ${i.insight}\n- Evidence: ${i.evidence}\n- Actionable: ${i.actionable}${i.supersedes ? `\n- Supersedes: ${i.supersedes}` : ''}`)
    .join('\n\n');
  writeInsight(markdown);
}

export function readRecentInsights(count: number): StructuredInsight[] {
  const dir = INSIGHTS_DIR();
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, count);

  const insights: StructuredInsight[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), 'utf8');
      const parsed = JSON.parse(content) as StructuredInsight[];
      insights.push(...parsed);
    } catch {
      // Skip corrupt files
    }
  }

  return insights;
}

// ── Shared Patterns ──

export interface SharedPattern {
  name: string;
  content: string;
  observations: number;
  applicableTo: string[];
  confidence: string;
  createdAt: string;
  expiresAt: string;
}

export function writeSharedPattern(name: string, pattern: SharedPattern): void {
  const dir = join(SHARED_DOCS_DIR(), 'patterns');
  mkdirSync(dir, { recursive: true });

  const filename = `${sanitizeName(name)}.json`;
  writeFileSync(join(dir, filename), JSON.stringify(pattern, null, 2), 'utf8');

  // Also write human-readable markdown
  const mdFilename = `${sanitizeName(name)}.md`;
  const markdown = `# ${name}\n\n${pattern.content}\n\n- Observations: ${pattern.observations}\n- Applies to: ${pattern.applicableTo.join(', ')}\n- Confidence: ${pattern.confidence}\n- Expires: ${pattern.expiresAt}\n`;
  writeFileSync(join(dir, mdFilename), markdown, 'utf8');
}

export function readSharedPatterns(): SharedPattern[] {
  const dir = join(SHARED_DOCS_DIR(), 'patterns');
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const patterns: SharedPattern[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), 'utf8');
      patterns.push(JSON.parse(content) as SharedPattern);
    } catch {
      // Skip corrupt files
    }
  }

  return patterns;
}

// ── Anti-Patterns ──

export interface AntiPattern {
  pattern: string;
  reason: string;
  evidence: string;
  applicableTo: string[];
  createdAt: string;
}

export function writeAntiPattern(name: string, antiPattern: AntiPattern): void {
  const dir = join(SHARED_DOCS_DIR(), 'anti-patterns');
  mkdirSync(dir, { recursive: true });

  const filename = `${sanitizeName(name)}.json`;
  writeFileSync(join(dir, filename), JSON.stringify(antiPattern, null, 2), 'utf8');

  const mdFilename = `${sanitizeName(name)}.md`;
  const markdown = `# Anti-Pattern: ${name}\n\n**Pattern:** ${antiPattern.pattern}\n\n**Why it's harmful:** ${antiPattern.reason}\n\n**Evidence:** ${antiPattern.evidence}\n\n**Applies to:** ${antiPattern.applicableTo.join(', ')}\n`;
  writeFileSync(join(dir, mdFilename), markdown, 'utf8');
}

export function readAntiPatterns(): AntiPattern[] {
  const dir = join(SHARED_DOCS_DIR(), 'anti-patterns');
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const patterns: AntiPattern[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), 'utf8');
      patterns.push(JSON.parse(content) as AntiPattern);
    } catch {
      // Skip corrupt files
    }
  }

  return patterns;
}

// ── Feedback Tracking ──

export interface FeedbackLogEntry {
  date: string;
  project: string;
  insightId?: string;
  actedOn: boolean;
  outcome?: string;
}

export function writeFeedbackLog(entries: FeedbackLogEntry[]): void {
  if (entries.length === 0) return;

  const dir = INSIGHTS_DIR();
  mkdirSync(dir, { recursive: true });

  const logPath = join(dir, 'feedback-log.json');
  let existing: FeedbackLogEntry[] = [];
  if (existsSync(logPath)) {
    try {
      existing = JSON.parse(readFileSync(logPath, 'utf8'));
    } catch {
      // Corrupt file, overwrite
    }
  }

  const merged = [...existing, ...entries];
  // Keep only last 500 entries to prevent unbounded growth
  const trimmed = merged.slice(-500);
  writeFileSync(logPath, JSON.stringify(trimmed, null, 2), 'utf8');
}

export function readFeedbackLog(): FeedbackLogEntry[] {
  const logPath = join(INSIGHTS_DIR(), 'feedback-log.json');
  if (!existsSync(logPath)) return [];

  try {
    return JSON.parse(readFileSync(logPath, 'utf8'));
  } catch {
    return [];
  }
}

// ── Helpers ──

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
