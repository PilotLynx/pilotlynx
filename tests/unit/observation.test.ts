import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../src/lib/config.js';
import { resetRegistryCache, registerProject } from '../../src/lib/registry.js';
import { getRecentLogs, writeInsight } from '../../src/lib/observation.js';

describe('observation', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-test-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetRegistryCache();

    // Projects live at workspace root (tmpDir), config at configDir
    mkdirSync(join(tmpDir, 'testproj', 'logs'), { recursive: true });
    mkdirSync(join(configDir, 'shared', 'insights'), { recursive: true });

    // Register test project
    registerProject('testproj', join(tmpDir, 'testproj'));
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

  describe('getRecentLogs', () => {
    it('returns empty array when no logs directory exists', () => {
      mkdirSync(join(tmpDir, 'emptyproj'), { recursive: true });
      registerProject('emptyproj', join(tmpDir, 'emptyproj'));
      expect(getRecentLogs('emptyproj', 1)).toEqual([]);
    });

    it('returns empty array when logs directory is empty', () => {
      expect(getRecentLogs('testproj', 1)).toEqual([]);
    });

    it('returns logs within the time window', () => {
      const logsDir = join(tmpDir, 'testproj', 'logs');
      const now = new Date();
      const record = {
        project: 'testproj',
        workflow: 'daily_feedback',
        startedAt: now.toISOString(),
        completedAt: now.toISOString(),
        success: true,
        summary: 'OK',
        costUsd: 0.01,
        numTurns: 2,
      };
      writeFileSync(join(logsDir, 'run1.json'), JSON.stringify(record));
      const logs = getRecentLogs('testproj', 1);
      expect(logs).toHaveLength(1);
      expect(logs[0].workflow).toBe('daily_feedback');
    });

    it('excludes logs outside the time window', () => {
      const logsDir = join(tmpDir, 'testproj', 'logs');
      const old = new Date();
      old.setDate(old.getDate() - 5);
      const record = {
        project: 'testproj',
        workflow: 'old_run',
        startedAt: old.toISOString(),
        completedAt: old.toISOString(),
        success: true,
        summary: 'old',
        costUsd: 0,
        numTurns: 1,
      };
      writeFileSync(join(logsDir, 'old.json'), JSON.stringify(record));
      expect(getRecentLogs('testproj', 1)).toEqual([]);
    });

    it('sorts logs by startedAt ascending', () => {
      const logsDir = join(tmpDir, 'testproj', 'logs');
      const now = new Date();
      const earlier = new Date(now.getTime() - 60000);

      const record1 = {
        project: 'testproj', workflow: 'second', startedAt: now.toISOString(),
        completedAt: now.toISOString(), success: true, summary: 'b', costUsd: 0, numTurns: 1,
      };
      const record2 = {
        project: 'testproj', workflow: 'first', startedAt: earlier.toISOString(),
        completedAt: earlier.toISOString(), success: true, summary: 'a', costUsd: 0, numTurns: 1,
      };
      writeFileSync(join(logsDir, 'z_second.json'), JSON.stringify(record1));
      writeFileSync(join(logsDir, 'a_first.json'), JSON.stringify(record2));

      const logs = getRecentLogs('testproj', 1);
      expect(logs).toHaveLength(2);
      expect(logs[0].workflow).toBe('first');
      expect(logs[1].workflow).toBe('second');
    });

    it('skips malformed JSON files gracefully', () => {
      const logsDir = join(tmpDir, 'testproj', 'logs');
      writeFileSync(join(logsDir, 'bad.json'), 'not json{{{');
      const now = new Date();
      const record = {
        project: 'testproj', workflow: 'good', startedAt: now.toISOString(),
        completedAt: now.toISOString(), success: true, summary: 'ok', costUsd: 0, numTurns: 1,
      };
      writeFileSync(join(logsDir, 'good.json'), JSON.stringify(record));
      const logs = getRecentLogs('testproj', 1);
      expect(logs).toHaveLength(1);
      expect(logs[0].workflow).toBe('good');
    });

    it('ignores non-JSON files', () => {
      const logsDir = join(tmpDir, 'testproj', 'logs');
      writeFileSync(join(logsDir, 'readme.txt'), 'not a log');
      expect(getRecentLogs('testproj', 1)).toEqual([]);
    });
  });

  describe('writeInsight', () => {
    it('creates a new insight file with date-based name', () => {
      writeInsight('Test insight content');
      const insightsDir = join(configDir, 'shared', 'insights');
      const now = new Date();
      const y = now.getFullYear();
      const mo = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const expectedFile = `${y}-${mo}-${d}.md`;
      expect(existsSync(join(insightsDir, expectedFile))).toBe(true);
      const content = readFileSync(join(insightsDir, expectedFile), 'utf8');
      expect(content).toBe('Test insight content');
    });

    it('appends to existing insight file for same day', () => {
      writeInsight('First insight');
      writeInsight('Second insight');
      const insightsDir = join(configDir, 'shared', 'insights');
      const now = new Date();
      const y = now.getFullYear();
      const mo = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const content = readFileSync(join(insightsDir, `${y}-${mo}-${d}.md`), 'utf8');
      expect(content).toContain('First insight');
      expect(content).toContain('Second insight');
    });

    it('creates insights directory if it does not exist', () => {
      rmSync(join(configDir, 'shared', 'insights'), { recursive: true, force: true });
      writeInsight('New insight');
      expect(existsSync(join(configDir, 'shared', 'insights'))).toBe(true);
    });
  });
});
