import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../src/lib/config.js';
import { resetRegistryCache, registerProject } from '../../src/lib/registry.js';
import { getRecentLogs } from '../../src/lib/observation.js';
import type { RunRecord } from '../../src/lib/types.js';

function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  const now = new Date();
  return {
    project: 'proj',
    workflow: 'daily_feedback',
    startedAt: now.toISOString(),
    completedAt: new Date(now.getTime() + 30000).toISOString(),
    success: true,
    summary: 'Completed successfully',
    costUsd: 0.01,
    numTurns: 3,
    ...overrides,
  };
}

describe('logs command', () => {
  let tmpDir: string;
  let configDir: string;
  let projectDir: string;
  let logsDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-logs-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    projectDir = join(tmpDir, 'proj');
    logsDir = join(projectDir, 'logs');
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetRegistryCache();

    mkdirSync(join(configDir, 'shared', 'policies'), { recursive: true });
    writeFileSync(join(configDir, 'projects.yaml'), 'version: 1\nprojects: {}\n');
    mkdirSync(logsDir, { recursive: true });
    registerProject('proj', projectDir);
  });

  afterEach(() => {
    if (origEnv !== undefined) process.env.PILOTLYNX_ROOT = origEnv;
    else delete process.env.PILOTLYNX_ROOT;
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    resetRegistryCache();
  });

  it('returns recent logs within 30-day window', () => {
    writeFileSync(join(logsDir, 'run1.json'), JSON.stringify(makeRecord()));
    const logs = getRecentLogs('proj', 30);
    expect(logs).toHaveLength(1);
  });

  it('filters by workflow name', () => {
    writeFileSync(join(logsDir, 'run1.json'), JSON.stringify(makeRecord({ workflow: 'daily_feedback' })));
    writeFileSync(join(logsDir, 'run2.json'), JSON.stringify(makeRecord({ workflow: 'task_execute' })));
    const logs = getRecentLogs('proj', 30).filter((r) => r.workflow === 'daily_feedback');
    expect(logs).toHaveLength(1);
    expect(logs[0].workflow).toBe('daily_feedback');
  });

  it('filters failures', () => {
    writeFileSync(join(logsDir, 'ok.json'), JSON.stringify(makeRecord({ success: true })));
    writeFileSync(join(logsDir, 'fail.json'), JSON.stringify(makeRecord({ success: false, error: 'boom' })));
    const logs = getRecentLogs('proj', 30).filter((r) => !r.success);
    expect(logs).toHaveLength(1);
    expect(logs[0].success).toBe(false);
  });

  it('respects limit by slicing', () => {
    for (let i = 0; i < 15; i++) {
      const startedAt = new Date(Date.now() - (15 - i) * 60000).toISOString();
      writeFileSync(join(logsDir, `run${i}.json`), JSON.stringify(makeRecord({ startedAt, completedAt: startedAt })));
    }
    const all = getRecentLogs('proj', 30);
    const limited = all.slice(-10);
    expect(limited).toHaveLength(10);
  });

  it('returns empty for project with no logs', () => {
    const logs = getRecentLogs('proj', 30);
    expect(logs).toHaveLength(0);
  });

  it('computes duration from startedAt and completedAt', () => {
    const start = new Date();
    const end = new Date(start.getTime() + 45000);
    writeFileSync(join(logsDir, 'run.json'), JSON.stringify(makeRecord({
      startedAt: start.toISOString(),
      completedAt: end.toISOString(),
    })));
    const logs = getRecentLogs('proj', 30);
    const durationMs = new Date(logs[0].completedAt).getTime() - new Date(logs[0].startedAt).getTime();
    expect(durationMs).toBe(45000);
  });
});
