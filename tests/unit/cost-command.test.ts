import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../src/lib/config.js';
import { resetRegistryCache, registerProject } from '../../src/lib/registry.js';
import { getRecentLogs } from '../../src/lib/observation.js';
import type { RunRecord } from '../../src/lib/types.js';

describe('cost command data aggregation', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
    const now = new Date();
    return {
      project: 'myapp',
      workflow: 'daily_check',
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      success: true,
      summary: 'OK',
      costUsd: 0.01,
      numTurns: 2,
      ...overrides,
    };
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pilotlynx-test-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    mkdirSync(configDir, { recursive: true });
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetRegistryCache();
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.PILOTLYNX_ROOT = origEnv;
    } else {
      delete process.env.PILOTLYNX_ROOT;
    }
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    resetRegistryCache();
  });

  it('aggregates cost across multiple runs', () => {
    const projDir = join(tmpDir, 'myapp');
    mkdirSync(join(projDir, 'logs'), { recursive: true });
    registerProject('myapp', projDir);

    writeFileSync(join(projDir, 'logs', 'r1.json'), JSON.stringify(makeRecord({ costUsd: 0.05 })));
    writeFileSync(join(projDir, 'logs', 'r2.json'), JSON.stringify(makeRecord({ costUsd: 0.10 })));
    writeFileSync(join(projDir, 'logs', 'r3.json'), JSON.stringify(makeRecord({ costUsd: 0.03, success: false })));

    const logs = getRecentLogs('myapp', 7);
    expect(logs).toHaveLength(3);

    const totalCost = logs.reduce((s, l) => s + l.costUsd, 0);
    expect(totalCost).toBeCloseTo(0.18);

    const failures = logs.filter(l => !l.success);
    expect(failures).toHaveLength(1);
  });

  it('groups by workflow correctly', () => {
    const projDir = join(tmpDir, 'myapp');
    mkdirSync(join(projDir, 'logs'), { recursive: true });
    registerProject('myapp', projDir);

    writeFileSync(join(projDir, 'logs', 'r1.json'), JSON.stringify(makeRecord({ workflow: 'build', costUsd: 0.05 })));
    writeFileSync(join(projDir, 'logs', 'r2.json'), JSON.stringify(makeRecord({ workflow: 'build', costUsd: 0.10 })));
    writeFileSync(join(projDir, 'logs', 'r3.json'), JSON.stringify(makeRecord({ workflow: 'test', costUsd: 0.02 })));

    const logs = getRecentLogs('myapp', 7);
    const groups = new Map<string, RunRecord[]>();
    for (const log of logs) {
      const arr = groups.get(log.workflow) ?? [];
      arr.push(log);
      groups.set(log.workflow, arr);
    }

    expect(groups.get('build')).toHaveLength(2);
    expect(groups.get('test')).toHaveLength(1);

    const buildCost = groups.get('build')!.reduce((s, l) => s + l.costUsd, 0);
    expect(buildCost).toBeCloseTo(0.15);
  });

  it('filters by date (--since equivalent)', () => {
    const projDir = join(tmpDir, 'myapp');
    mkdirSync(join(projDir, 'logs'), { recursive: true });
    registerProject('myapp', projDir);

    const old = new Date();
    old.setDate(old.getDate() - 10);
    const recent = new Date();

    writeFileSync(join(projDir, 'logs', 'old.json'), JSON.stringify(makeRecord({ startedAt: old.toISOString(), completedAt: old.toISOString(), costUsd: 0.50 })));
    writeFileSync(join(projDir, 'logs', 'new.json'), JSON.stringify(makeRecord({ startedAt: recent.toISOString(), completedAt: recent.toISOString(), costUsd: 0.10 })));

    // Using 7 days window should exclude the old record
    const logs = getRecentLogs('myapp', 7);
    expect(logs).toHaveLength(1);
    expect(logs[0].costUsd).toBeCloseTo(0.10);
  });

  it('aggregates across multiple projects', () => {
    const proj1Dir = join(tmpDir, 'proj1');
    const proj2Dir = join(tmpDir, 'proj2');
    mkdirSync(join(proj1Dir, 'logs'), { recursive: true });
    mkdirSync(join(proj2Dir, 'logs'), { recursive: true });
    registerProject('proj1', proj1Dir);
    registerProject('proj2', proj2Dir);

    writeFileSync(join(proj1Dir, 'logs', 'r1.json'), JSON.stringify(makeRecord({ project: 'proj1', costUsd: 0.05 })));
    writeFileSync(join(proj2Dir, 'logs', 'r1.json'), JSON.stringify(makeRecord({ project: 'proj2', costUsd: 0.15 })));

    const logs1 = getRecentLogs('proj1', 7);
    const logs2 = getRecentLogs('proj2', 7);
    const allLogs = [...logs1, ...logs2];

    const totalCost = allLogs.reduce((s, l) => s + l.costUsd, 0);
    expect(totalCost).toBeCloseTo(0.20);
  });
});
