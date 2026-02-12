import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import YAML from 'yaml';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../../src/lib/config.js';
import { resetRegistryCache, registerProject } from '../../../src/lib/registry.js';
import { getWorkspaceStatus } from '../../../src/lib/command-ops/status-ops.js';
import { resetPolicyCache } from '../../../src/lib/policy.js';

describe('status-ops', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-test-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    mkdirSync(configDir, { recursive: true });
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetRegistryCache();
    resetPolicyCache();

    // Create workspace marker
    writeFileSync(
      join(configDir, 'plynx.yaml'),
      YAML.stringify({ version: 1, name: 'test-ws', autoImprove: { enabled: true } })
    );
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
    resetPolicyCache();
  });

  it('returns empty projects array when no projects registered', () => {
    const status = getWorkspaceStatus();
    expect(status.projects).toEqual([]);
    expect(status.configRoot).toBe(configDir);
  });

  it('returns project with cost and last run info', () => {
    const projDir = join(tmpDir, 'myapp');
    mkdirSync(join(projDir, 'logs'), { recursive: true });
    registerProject('myapp', projDir);

    const now = new Date();
    const record = {
      project: 'myapp',
      workflow: 'daily_check',
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      success: true,
      summary: 'OK',
      costUsd: 0.05,
      numTurns: 3,
    };
    writeFileSync(join(projDir, 'logs', 'run1.json'), JSON.stringify(record));

    const status = getWorkspaceStatus();
    expect(status.projects).toHaveLength(1);
    expect(status.projects[0].name).toBe('myapp');
    expect(status.projects[0].lastStatus).toBe('OK');
    expect(status.projects[0].cost7d).toBeCloseTo(0.05);
  });

  it('reports auto-improve status from workspace config', () => {
    const status = getWorkspaceStatus();
    expect(status.autoImproveEnabled).toBe(true);
  });

  it('reports auto-improve disabled when config says so', () => {
    writeFileSync(
      join(configDir, 'plynx.yaml'),
      YAML.stringify({ version: 1, name: 'test-ws', autoImprove: { enabled: false } })
    );
    const status = getWorkspaceStatus();
    expect(status.autoImproveEnabled).toBe(false);
  });

  it('counts scheduled workflows across projects', () => {
    const projDir = join(tmpDir, 'scheduled');
    mkdirSync(projDir, { recursive: true });
    registerProject('scheduled', projDir);

    writeFileSync(
      join(projDir, 'schedule.yaml'),
      YAML.stringify({
        schedules: [
          { workflow: 'daily_check', cron: '0 9 * * *' },
          { workflow: 'weekly_report', cron: '0 12 * * 1' },
        ],
      })
    );

    const status = getWorkspaceStatus();
    expect(status.scheduledWorkflows).toBe(2);
  });

  it('handles projects without schedule configs', () => {
    const projDir = join(tmpDir, 'nosched');
    mkdirSync(projDir, { recursive: true });
    registerProject('nosched', projDir);

    const status = getWorkspaceStatus();
    expect(status.scheduledWorkflows).toBe(0);
    expect(status.projects[0].nextScheduled).toBeNull();
  });

  it('reports relay as not configured by default', () => {
    const status = getWorkspaceStatus();
    expect(status.relayConfigured).toBe(false);
  });

  it('reports relay as configured when enabled', () => {
    writeFileSync(
      join(configDir, 'relay.yaml'),
      YAML.stringify({
        version: 1,
        enabled: true,
        channels: { telegram: { enabled: false }, webhook: { enabled: false } },
        notifications: { onScheduleComplete: true, onScheduleFailure: true },
        routing: { defaultProject: null, chats: {}, allowedUsers: [] },
      })
    );

    const status = getWorkspaceStatus();
    expect(status.relayConfigured).toBe(true);
  });

  it('reports last improve run when available', () => {
    const lastRun = new Date().toISOString();
    writeFileSync(
      join(configDir, 'improve-state.json'),
      JSON.stringify({ lastRun })
    );

    const status = getWorkspaceStatus();
    expect(status.lastImproveRun).toBe(lastRun);
  });

  it('shows FAIL status for last failed run', () => {
    const projDir = join(tmpDir, 'failproj');
    mkdirSync(join(projDir, 'logs'), { recursive: true });
    registerProject('failproj', projDir);

    const now = new Date();
    const record = {
      project: 'failproj',
      workflow: 'broken',
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      success: false,
      summary: 'error occurred',
      costUsd: 0.01,
      numTurns: 1,
      error: 'something went wrong',
    };
    writeFileSync(join(projDir, 'logs', 'run1.json'), JSON.stringify(record));

    const status = getWorkspaceStatus();
    expect(status.projects[0].lastStatus).toBe('FAIL');
  });
});
