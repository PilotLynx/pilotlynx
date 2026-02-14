import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetConfigCache, CONFIG_DIR_NAME, INSIGHTS_DIR, SHARED_DOCS_DIR } from '../../src/lib/config.js';
import { resetRegistryCache, registerProject } from '../../src/lib/registry.js';
import {
  getLogStatistics,
  writeStructuredInsights,
  readRecentInsights,
  writeSharedPattern,
  readSharedPatterns,
  writeAntiPattern,
  readAntiPatterns,
  writeFeedbackLog,
  readFeedbackLog,
} from '../../src/lib/observation.js';

describe('observation statistics and patterns', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pilotlynx-obs-stats-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetRegistryCache();

    mkdirSync(join(configDir, 'shared', 'policies'), { recursive: true });
    mkdirSync(join(configDir, 'shared', 'insights'), { recursive: true });
    mkdirSync(join(configDir, 'shared', 'docs'), { recursive: true });
    writeFileSync(join(configDir, 'projects.yaml'), 'version: 1\nprojects: {}\n');
  });

  afterEach(() => {
    if (origEnv !== undefined) process.env.PILOTLYNX_ROOT = origEnv;
    else delete process.env.PILOTLYNX_ROOT;
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    resetRegistryCache();
  });

  describe('getLogStatistics', () => {
    it('returns zero stats for project with no logs', () => {
      const projectDir = join(tmpDir, 'test-project');
      mkdirSync(projectDir, { recursive: true });
      registerProject('test-project', projectDir);

      const stats = getLogStatistics('test-project', 7);
      expect(stats.totalRuns).toBe(0);
      expect(stats.failureRate).toBe(0);
      expect(stats.avgCostUsd).toBe(0);
    });

    it('computes correct statistics from log files', () => {
      const projectDir = join(tmpDir, 'test-project');
      const logsDir = join(projectDir, 'logs');
      mkdirSync(logsDir, { recursive: true });
      registerProject('test-project', projectDir);

      const now = new Date();
      const logs = [
        { project: 'test-project', workflow: 'task_execute', startedAt: now.toISOString(), completedAt: new Date(now.getTime() + 5000).toISOString(), success: true, summary: 'OK', costUsd: 0.1, numTurns: 5 },
        { project: 'test-project', workflow: 'task_execute', startedAt: now.toISOString(), completedAt: new Date(now.getTime() + 3000).toISOString(), success: false, summary: 'Failed', costUsd: 0.05, numTurns: 3, error: 'Timeout' },
        { project: 'test-project', workflow: 'daily_feedback', startedAt: now.toISOString(), completedAt: new Date(now.getTime() + 2000).toISOString(), success: true, summary: 'OK', costUsd: 0.02, numTurns: 2 },
      ];

      logs.forEach((log, i) => {
        writeFileSync(join(logsDir, `log_${i}.json`), JSON.stringify(log));
      });

      const stats = getLogStatistics('test-project', 7);
      expect(stats.totalRuns).toBe(3);
      expect(stats.successCount).toBe(2);
      expect(stats.failureCount).toBe(1);
      expect(stats.failureRate).toBeCloseTo(1 / 3);
      expect(stats.totalCostUsd).toBeCloseTo(0.17);
      expect(stats.avgCostUsd).toBeCloseTo(0.17 / 3);
      expect(stats.topWorkflows.length).toBe(2);
      expect(stats.topErrors.length).toBe(1);
      expect(stats.topErrors[0]).toContain('Timeout');
    });
  });

  describe('structured insights', () => {
    it('writes and reads structured insights', () => {
      const insights = [
        { id: 'ins-001', category: 'cost', insight: 'Reduce tokens', actionable: true, evidence: 'data', date: '2025-01-15' },
        { id: 'ins-002', category: 'reliability', insight: 'Add retries', actionable: true, evidence: 'logs', date: '2025-01-15' },
      ];

      writeStructuredInsights(insights);

      const read = readRecentInsights(5);
      expect(read.length).toBe(2);
      expect(read[0].id).toBe('ins-001');
      expect(read[1].category).toBe('reliability');
    });

    it('does nothing for empty insights array', () => {
      writeStructuredInsights([]);
      const read = readRecentInsights(5);
      expect(read.length).toBe(0);
    });
  });

  describe('shared patterns', () => {
    it('writes and reads shared patterns', () => {
      writeSharedPattern('retry-logic', {
        name: 'retry-logic',
        content: 'Use exponential backoff for API calls',
        observations: 3,
        applicableTo: ['api-integration'],
        confidence: 'high',
        createdAt: '2025-01-15T00:00:00Z',
        expiresAt: '2099-04-15T00:00:00Z',
      });

      const patterns = readSharedPatterns();
      expect(patterns.length).toBe(1);
      expect(patterns[0].name).toBe('retry-logic');
      expect(patterns[0].observations).toBe(3);

      // Verify markdown file also exists
      const patternsDir = join(SHARED_DOCS_DIR(), 'patterns');
      const files = readdirSync(patternsDir);
      expect(files).toContain('retry-logic.json');
      expect(files).toContain('retry-logic.md');
    });

    it('returns empty array when no patterns directory', () => {
      const patterns = readSharedPatterns();
      expect(patterns).toEqual([]);
    });
  });

  describe('anti-patterns', () => {
    it('writes and reads anti-patterns', () => {
      writeAntiPattern('no-timeout', {
        pattern: 'API calls without timeout',
        reason: 'Causes hanging requests and resource leaks',
        evidence: '5 timeout errors in 3 days',
        applicableTo: ['api-integration'],
        createdAt: '2025-01-15T00:00:00Z',
      });

      const antiPatterns = readAntiPatterns();
      expect(antiPatterns.length).toBe(1);
      expect(antiPatterns[0].pattern).toBe('API calls without timeout');

      // Verify markdown file also exists
      const dir = join(SHARED_DOCS_DIR(), 'anti-patterns');
      const files = readdirSync(dir);
      expect(files).toContain('no-timeout.json');
      expect(files).toContain('no-timeout.md');
    });

    it('returns empty array when no anti-patterns directory', () => {
      const antiPatterns = readAntiPatterns();
      expect(antiPatterns).toEqual([]);
    });
  });

  describe('feedback log', () => {
    it('writes and reads feedback log entries', () => {
      const entries = [
        { date: '2025-01-15T00:00:00Z', project: 'app1', actedOn: true, outcome: 'applied' },
        { date: '2025-01-15T00:00:00Z', project: 'app2', actedOn: false, outcome: 'agent_failed' },
      ];

      writeFeedbackLog(entries);

      const log = readFeedbackLog();
      expect(log.length).toBe(2);
      expect(log[0].project).toBe('app1');
      expect(log[0].actedOn).toBe(true);
      expect(log[1].actedOn).toBe(false);
    });

    it('appends to existing log', () => {
      writeFeedbackLog([{ date: '2025-01-14', project: 'app1', actedOn: true }]);
      writeFeedbackLog([{ date: '2025-01-15', project: 'app2', actedOn: false }]);

      const log = readFeedbackLog();
      expect(log.length).toBe(2);
    });

    it('returns empty array when no log exists', () => {
      const log = readFeedbackLog();
      expect(log).toEqual([]);
    });

    it('does nothing for empty entries', () => {
      writeFeedbackLog([]);
      const log = readFeedbackLog();
      expect(log).toEqual([]);
    });
  });
});
