import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { writeAuditEntry, readAuditEntries, formatAuditCSV } from '../../src/lib/audit.js';
import type { AuditEntry } from '../../src/lib/types.js';

let tmpDir: string;
let projectDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `pilotlynx-audit-test-${randomUUID()}`);
  projectDir = join(tmpDir, 'test-project');
  mkdirSync(projectDir, { recursive: true });

  // Mock getProjectDir to return our temp project directory
  vi.mock('../../src/lib/config.js', () => ({
    getProjectDir: (name: string) => join(tmpDir, name),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

function makeEntry(overrides?: Partial<AuditEntry>): AuditEntry {
  return {
    timestamp: '2025-06-15T10:30:00Z',
    project: 'test-project',
    workflow: 'daily-check',
    triggeredBy: 'cli',
    runId: 'run-001',
    success: true,
    costUsd: 0.05,
    durationMs: 12000,
    toolInvocations: ['Bash', 'Read', 'Write'],
    model: 'claude-sonnet-4-5-20250929',
    ...overrides,
  };
}

// ── writeAuditEntry ──

describe('writeAuditEntry', () => {
  it('creates the audit directory and writes a JSONL file', () => {
    const entry = makeEntry();
    writeAuditEntry('test-project', entry);

    const auditDir = join(projectDir, 'logs', 'audit');
    expect(existsSync(auditDir)).toBe(true);

    const filePath = join(auditDir, '2025-06-15.jsonl');
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.project).toBe('test-project');
    expect(parsed.workflow).toBe('daily-check');
    expect(parsed.success).toBe(true);
  });

  it('appends multiple entries to the same daily file', () => {
    writeAuditEntry('test-project', makeEntry({ runId: 'run-001' }));
    writeAuditEntry('test-project', makeEntry({ runId: 'run-002' }));

    const filePath = join(projectDir, 'logs', 'audit', '2025-06-15.jsonl');
    const lines = readFileSync(filePath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);

    expect(JSON.parse(lines[0]).runId).toBe('run-001');
    expect(JSON.parse(lines[1]).runId).toBe('run-002');
  });

  it('creates separate files for different dates', () => {
    writeAuditEntry('test-project', makeEntry({ timestamp: '2025-06-15T10:00:00Z' }));
    writeAuditEntry('test-project', makeEntry({ timestamp: '2025-06-16T10:00:00Z' }));

    const auditDir = join(projectDir, 'logs', 'audit');
    expect(existsSync(join(auditDir, '2025-06-15.jsonl'))).toBe(true);
    expect(existsSync(join(auditDir, '2025-06-16.jsonl'))).toBe(true);
  });
});

// ── readAuditEntries ──

describe('readAuditEntries', () => {
  it('returns empty array when audit directory does not exist', () => {
    const entries = readAuditEntries('test-project');
    expect(entries).toEqual([]);
  });

  it('reads entries from JSONL files', () => {
    const today = new Date().toISOString().split('T')[0];
    writeAuditEntry('test-project', makeEntry({ runId: 'run-001', timestamp: `${today}T10:00:00Z` }));
    writeAuditEntry('test-project', makeEntry({ runId: 'run-002', timestamp: `${today}T11:00:00Z` }));

    const entries = readAuditEntries('test-project');
    expect(entries).toHaveLength(2);
  });

  it('filters by workflow', () => {
    const today = new Date().toISOString().split('T')[0];
    writeAuditEntry('test-project', makeEntry({ workflow: 'daily-check', runId: 'r1', timestamp: `${today}T10:00:00Z` }));
    writeAuditEntry('test-project', makeEntry({ workflow: 'deploy', runId: 'r2', timestamp: `${today}T11:00:00Z` }));

    const entries = readAuditEntries('test-project', { workflow: 'deploy' });
    expect(entries).toHaveLength(1);
    expect(entries[0].workflow).toBe('deploy');
  });

  it('filters by days', () => {
    // Write a recent entry
    const today = new Date().toISOString().split('T')[0];
    writeAuditEntry('test-project', makeEntry({
      timestamp: `${today}T10:00:00Z`,
      runId: 'recent',
    }));

    // Write an old entry (filename-based filtering)
    const oldDate = '2020-01-01';
    const auditDir = join(projectDir, 'logs', 'audit');
    mkdirSync(auditDir, { recursive: true });
    writeFileSync(
      join(auditDir, `${oldDate}.jsonl`),
      JSON.stringify(makeEntry({ timestamp: `${oldDate}T10:00:00Z`, runId: 'old' })) + '\n',
    );

    const entries = readAuditEntries('test-project', { days: 7 });
    expect(entries.some(e => e.runId === 'recent')).toBe(true);
    expect(entries.some(e => e.runId === 'old')).toBe(false);
  });

  it('skips corrupt JSON lines without throwing', () => {
    const auditDir = join(projectDir, 'logs', 'audit');
    mkdirSync(auditDir, { recursive: true });

    const today = new Date().toISOString().split('T')[0];
    const content = [
      JSON.stringify(makeEntry({ runId: 'good-1' })),
      'this is not valid json{{{',
      JSON.stringify(makeEntry({ runId: 'good-2' })),
    ].join('\n');

    writeFileSync(join(auditDir, `${today}.jsonl`), content + '\n');

    const entries = readAuditEntries('test-project');
    expect(entries).toHaveLength(2);
    expect(entries[0].runId).toBe('good-1');
    expect(entries[1].runId).toBe('good-2');
  });
});

// ── formatAuditCSV ──

describe('formatAuditCSV', () => {
  it('produces valid CSV with header and data rows', () => {
    const entries = [
      makeEntry({ runId: 'r1', costUsd: 0.1234, durationMs: 5000 }),
      makeEntry({ runId: 'r2', costUsd: 0.5678, durationMs: 10000 }),
    ];

    const csv = formatAuditCSV(entries);
    const lines = csv.split('\n');

    // Header
    expect(lines[0]).toBe('timestamp,project,workflow,triggeredBy,runId,success,costUsd,durationMs,model,toolInvocations');

    // Data rows
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[1]).toContain('r1');
    expect(lines[1]).toContain('0.1234');
    expect(lines[2]).toContain('r2');
    expect(lines[2]).toContain('0.5678');
  });

  it('handles entries with no model', () => {
    const entries = [makeEntry({ model: undefined })];
    const csv = formatAuditCSV(entries);
    const lines = csv.split('\n');

    // model field should be empty string
    expect(lines[1]).toContain(',,');
  });

  it('wraps toolInvocations in quotes with semicolons', () => {
    const entries = [makeEntry({ toolInvocations: ['Bash', 'Read', 'Write'] })];
    const csv = formatAuditCSV(entries);

    expect(csv).toContain('"Bash;Read;Write"');
  });

  it('returns only header for empty entries', () => {
    const csv = formatAuditCSV([]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('timestamp');
  });
});
