import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Cron } from 'croner';
import { loadScheduleConfig, loadScheduleState, loadImproveState } from '../../src/lib/schedule.js';
import { loadWorkspaceConfig, resetConfigCache, CONFIG_DIR_NAME } from '../../src/lib/config.js';
import { registerProject, resetRegistryCache } from '../../src/lib/registry.js';

describe('schedule status', () => {
  let tmpDir: string;
  let configDir: string;
  let projectDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pilotlynx-schedstat-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    projectDir = join(tmpDir, 'myproj');
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetRegistryCache();

    mkdirSync(join(configDir, 'shared', 'policies'), { recursive: true });
    writeFileSync(join(configDir, 'projects.yaml'), 'version: 1\nprojects: {}\n');
    writeFileSync(join(configDir, 'pilotlynx.yaml'), 'version: 1\nname: test\nautoImprove:\n  enabled: true\n');
    mkdirSync(projectDir, { recursive: true });
    registerProject('myproj', projectDir);
  });

  afterEach(() => {
    if (origEnv !== undefined) process.env.PILOTLYNX_ROOT = origEnv;
    else delete process.env.PILOTLYNX_ROOT;
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    resetRegistryCache();
  });

  it('loads schedule config with valid entries', () => {
    writeFileSync(join(projectDir, 'schedule.yaml'), [
      'schedules:',
      '  - workflow: daily_feedback',
      '    cron: "0 9 * * *"',
      '    timezone: UTC',
      '    catchUpPolicy: run_latest',
    ].join('\n'));

    const config = loadScheduleConfig('myproj');
    expect(config).not.toBeNull();
    expect(config!.schedules).toHaveLength(1);
    expect(config!.schedules[0].workflow).toBe('daily_feedback');
    expect(config!.schedules[0].cron).toBe('0 9 * * *');
  });

  it('computes next run from cron expression', () => {
    const job = new Cron('0 9 * * *', { timezone: 'UTC' });
    const next = job.nextRun(new Date());
    expect(next).toBeInstanceOf(Date);
    expect(next!.getTime()).toBeGreaterThan(Date.now());
  });

  it('loads schedule state with last runs', () => {
    writeFileSync(join(projectDir, 'schedule-state.json'), JSON.stringify({
      lastRuns: { daily_feedback: '2025-01-15T09:00:00Z' },
    }));
    const state = loadScheduleState('myproj');
    expect(state.lastRuns.daily_feedback).toBe('2025-01-15T09:00:00Z');
  });

  it('loads workspace config with auto-improve setting', () => {
    const config = loadWorkspaceConfig();
    expect(config.autoImprove.enabled).toBe(true);
  });

  it('loads improve state', () => {
    writeFileSync(join(configDir, 'improve-state.json'), JSON.stringify({ lastRun: '2025-01-15T12:00:00Z' }));
    const state = loadImproveState();
    expect(state.lastRun).toBe('2025-01-15T12:00:00Z');
  });

  it('returns null config when no schedule.yaml exists', () => {
    const config = loadScheduleConfig('myproj');
    expect(config).toBeNull();
  });
});
