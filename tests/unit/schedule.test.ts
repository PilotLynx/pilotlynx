import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getMissedRuns, applyCatchUpPolicy, evaluateSchedules, loadScheduleState, loadScheduleConfig, saveScheduleState, loadImproveState, saveImproveState } from '../../src/lib/schedule.js';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../src/lib/config.js';
import { registerProject, resetRegistryCache } from '../../src/lib/registry.js';
import type { ScheduleConfig, ScheduleState } from '../../src/lib/types.js';

describe('schedule', () => {
  describe('getMissedRuns', () => {
    it('returns missed runs for a simple cron', () => {
      const now = new Date('2025-01-15T12:00:00Z');
      const lastRun = new Date('2025-01-15T09:00:00Z');
      const runs = getMissedRuns('0 * * * *', lastRun, now, 'UTC');
      expect(runs.length).toBeGreaterThanOrEqual(2);
      expect(runs.length).toBeLessThanOrEqual(3);
    });

    it('returns empty when no runs are due', () => {
      const now = new Date('2025-01-15T10:30:00Z');
      const lastRun = new Date('2025-01-15T10:00:00Z');
      const runs = getMissedRuns('0 * * * *', lastRun, now, 'UTC');
      expect(runs).toHaveLength(0);
    });

    it('uses 24h lookback when lastRun is null', () => {
      const now = new Date('2025-01-15T12:00:00Z');
      const runs = getMissedRuns('0 0 * * *', null, now, 'UTC');
      expect(runs.length).toBeGreaterThanOrEqual(1);
    });

    it('caps lookback at 7 days by default', () => {
      const now = new Date('2025-01-15T12:00:00Z');
      const veryOldRun = new Date('2024-01-01T00:00:00Z');
      const runs = getMissedRuns('0 0 * * *', veryOldRun, now, 'UTC');
      expect(runs.length).toBeLessThanOrEqual(7);
    });

    it('respects custom maxLookbackDays', () => {
      const now = new Date('2025-01-15T12:00:00Z');
      const veryOldRun = new Date('2024-01-01T00:00:00Z');
      const runs = getMissedRuns('0 0 * * *', veryOldRun, now, 'UTC', 3);
      expect(runs.length).toBeLessThanOrEqual(3);
    });
  });

  describe('applyCatchUpPolicy', () => {
    const runs = [
      new Date('2025-01-15T08:00:00Z'),
      new Date('2025-01-15T09:00:00Z'),
      new Date('2025-01-15T10:00:00Z'),
    ];

    it('run_all returns all missed runs', () => {
      expect(applyCatchUpPolicy(runs, 'run_all')).toEqual(runs);
    });

    it('run_latest returns only the last run', () => {
      const result = applyCatchUpPolicy(runs, 'run_latest');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(new Date('2025-01-15T10:00:00Z'));
    });

    it('skip returns empty', () => {
      expect(applyCatchUpPolicy(runs, 'skip')).toEqual([]);
    });

    it('returns empty for empty input regardless of policy', () => {
      expect(applyCatchUpPolicy([], 'run_all')).toEqual([]);
      expect(applyCatchUpPolicy([], 'run_latest')).toEqual([]);
      expect(applyCatchUpPolicy([], 'skip')).toEqual([]);
    });
  });

  describe('evaluateSchedules', () => {
    it('returns scheduled runs for due workflows', () => {
      const config: ScheduleConfig = {
        schedules: [
          { workflow: 'daily_feedback', cron: '0 * * * *', timezone: 'UTC', catchUpPolicy: 'run_latest', maxLookbackDays: 7 },
        ],
      };
      const state: ScheduleState = {
        lastRuns: { daily_feedback: '2025-01-15T09:00:00Z' },
      };
      const now = new Date('2025-01-15T12:00:00Z');
      const runs = evaluateSchedules(config, state, now);
      expect(runs.length).toBeGreaterThanOrEqual(1);
      expect(runs[0].workflow).toBe('daily_feedback');
    });

    it('returns empty when all workflows are up to date', () => {
      const config: ScheduleConfig = {
        schedules: [
          { workflow: 'daily_feedback', cron: '0 * * * *', timezone: 'UTC', catchUpPolicy: 'run_latest', maxLookbackDays: 7 },
        ],
      };
      const now = new Date('2025-01-15T10:30:00Z');
      const state: ScheduleState = {
        lastRuns: { daily_feedback: '2025-01-15T10:00:00Z' },
      };
      const runs = evaluateSchedules(config, state, now);
      expect(runs).toHaveLength(0);
    });

    it('handles multiple workflows independently', () => {
      const config: ScheduleConfig = {
        schedules: [
          { workflow: 'wf_a', cron: '0 * * * *', timezone: 'UTC', catchUpPolicy: 'run_latest', maxLookbackDays: 7 },
          { workflow: 'wf_b', cron: '0 0 * * *', timezone: 'UTC', catchUpPolicy: 'run_latest', maxLookbackDays: 7 },
        ],
      };
      const state: ScheduleState = {
        lastRuns: {
          wf_a: '2025-01-15T09:00:00Z',
          wf_b: '2025-01-15T00:00:00Z',
        },
      };
      const now = new Date('2025-01-15T12:00:00Z');
      const runs = evaluateSchedules(config, state, now);
      expect(runs.some((r) => r.workflow === 'wf_a')).toBe(true);
      expect(runs.some((r) => r.workflow === 'wf_b')).toBe(false);
    });

    it('handles empty state (first run ever)', () => {
      const config: ScheduleConfig = {
        schedules: [
          { workflow: 'daily_feedback', cron: '0 0 * * *', timezone: 'UTC', catchUpPolicy: 'run_latest', maxLookbackDays: 7 },
        ],
      };
      const state: ScheduleState = { lastRuns: {} };
      const now = new Date('2025-01-15T12:00:00Z');
      const runs = evaluateSchedules(config, state, now);
      expect(runs.length).toBeGreaterThanOrEqual(1);
      expect(runs[0].workflow).toBe('daily_feedback');
    });

    it('respects skip catch-up policy', () => {
      const config: ScheduleConfig = {
        schedules: [
          { workflow: 'skipped', cron: '0 * * * *', timezone: 'UTC', catchUpPolicy: 'skip', maxLookbackDays: 7 },
        ],
      };
      const state: ScheduleState = {
        lastRuns: { skipped: '2025-01-15T06:00:00Z' },
      };
      const now = new Date('2025-01-15T12:00:00Z');
      const runs = evaluateSchedules(config, state, now);
      expect(runs).toHaveLength(0);
    });

    it('returns all missed runs with run_all policy', () => {
      const config: ScheduleConfig = {
        schedules: [
          { workflow: 'catch_all', cron: '0 * * * *', timezone: 'UTC', catchUpPolicy: 'run_all', maxLookbackDays: 7 },
        ],
      };
      const state: ScheduleState = {
        lastRuns: { catch_all: '2025-01-15T09:00:00Z' },
      };
      const now = new Date('2025-01-15T12:00:00Z');
      const runs = evaluateSchedules(config, state, now);
      expect(runs.length).toBeGreaterThanOrEqual(2);
      expect(runs.every((r) => r.workflow === 'catch_all')).toBe(true);
    });

    it('returns empty for empty schedule config', () => {
      const config: ScheduleConfig = { schedules: [] };
      const state: ScheduleState = { lastRuns: {} };
      const runs = evaluateSchedules(config, state, new Date());
      expect(runs).toHaveLength(0);
    });
  });

  describe('loadScheduleState / saveScheduleState', () => {
    let tmpDir: string;
    let configDir: string;
    let projectDir: string;
    const origEnv = process.env.PILOTLYNX_ROOT;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'pilotlynx-sched-'));
      configDir = join(tmpDir, CONFIG_DIR_NAME);
      projectDir = join(tmpDir, 'proj');
      process.env.PILOTLYNX_ROOT = configDir;
      resetConfigCache();
      resetRegistryCache();

      mkdirSync(join(configDir, 'shared', 'policies'), { recursive: true });
      writeFileSync(join(configDir, 'projects.yaml'), 'version: 1\nprojects: {}\n');
      mkdirSync(projectDir, { recursive: true });
      registerProject('proj', projectDir);
    });

    afterEach(() => {
      if (origEnv !== undefined) process.env.PILOTLYNX_ROOT = origEnv;
      else delete process.env.PILOTLYNX_ROOT;
      rmSync(tmpDir, { recursive: true, force: true });
      resetConfigCache();
      resetRegistryCache();
    });

    it('loadScheduleState returns empty state when file is missing', () => {
      const state = loadScheduleState('proj');
      expect(state).toEqual({ lastRuns: {} });
    });

    it('loadScheduleState returns empty state for malformed JSON', () => {
      writeFileSync(join(projectDir, 'schedule-state.json'), '!!!not json!!!');
      const state = loadScheduleState('proj');
      expect(state).toEqual({ lastRuns: {} });
    });

    it('saveScheduleState round-trips correctly', () => {
      const original: ScheduleState = { lastRuns: { daily_feedback: '2025-01-15T12:00:00Z' } };
      saveScheduleState('proj', original);
      const loaded = loadScheduleState('proj');
      expect(loaded).toEqual(original);
    });

    it('loadScheduleConfig returns null when file is missing', () => {
      const config = loadScheduleConfig('proj');
      expect(config).toBeNull();
    });
  });

  describe('loadImproveState / saveImproveState', () => {
    let tmpDir: string;
    let configDir: string;
    const origEnv = process.env.PILOTLYNX_ROOT;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'pilotlynx-imp-'));
      configDir = join(tmpDir, CONFIG_DIR_NAME);
      process.env.PILOTLYNX_ROOT = configDir;
      resetConfigCache();
      mkdirSync(configDir, { recursive: true });
    });

    afterEach(() => {
      if (origEnv !== undefined) process.env.PILOTLYNX_ROOT = origEnv;
      else delete process.env.PILOTLYNX_ROOT;
      rmSync(tmpDir, { recursive: true, force: true });
      resetConfigCache();
    });

    it('returns default state when file is missing', () => {
      const state = loadImproveState();
      expect(state).toEqual({ lastRun: null, projectFailures: {} });
    });

    it('returns default state for malformed JSON', () => {
      writeFileSync(join(configDir, 'improve-state.json'), '!!!bad!!!');
      const state = loadImproveState();
      expect(state).toEqual({ lastRun: null, projectFailures: {} });
    });

    it('round-trips correctly', () => {
      const ts = '2025-01-15T12:00:00.000Z';
      saveImproveState({ lastRun: ts, projectFailures: { app1: 2 } });
      const state = loadImproveState();
      expect(state).toEqual({ lastRun: ts, projectFailures: { app1: 2 } });
    });
  });
});
