import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../src/lib/config.js';
import { resetRegistryCache, registerProject } from '../../src/lib/registry.js';
import { writeRunLog } from '../../src/lib/logger.js';
import type { RunRecord } from '../../src/lib/types.js';

describe('writeRunLog', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pilotlynx-test-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetRegistryCache();

    mkdirSync(configDir, { recursive: true });
    mkdirSync(join(tmpDir, 'testproj'), { recursive: true });

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

  it('creates a valid JSON log file', () => {
    const record: RunRecord = {
      project: 'testproj',
      workflow: 'project_review',
      startedAt: '2025-01-15T10:00:00.000Z',
      completedAt: '2025-01-15T10:01:00.000Z',
      success: true,
      summary: 'Review completed successfully.',
      costUsd: 0.05,
      numTurns: 3,
    };

    writeRunLog('testproj', record);

    const logsDir = join(tmpDir, 'testproj', 'logs');
    const files = readdirSync(logsDir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^project_review_/);

    const content = JSON.parse(readFileSync(join(logsDir, files[0]), 'utf8'));
    expect(content.project).toBe('testproj');
    expect(content.workflow).toBe('project_review');
    expect(content.success).toBe(true);
  });

  it('creates logs directory if it does not exist', () => {
    const record: RunRecord = {
      project: 'testproj',
      workflow: 'task_execute',
      startedAt: '2025-01-15T10:00:00.000Z',
      completedAt: '2025-01-15T10:01:00.000Z',
      success: false,
      summary: 'Failed',
      costUsd: 0.01,
      numTurns: 1,
      error: 'Something went wrong',
    };

    writeRunLog('testproj', record);

    const logsDir = join(tmpDir, 'testproj', 'logs');
    const files = readdirSync(logsDir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
  });

  it('produces unique filenames for same-millisecond writes', () => {
    const record: RunRecord = {
      project: 'testproj',
      workflow: 'daily_feedback',
      startedAt: '2025-01-15T10:00:00.000Z',
      completedAt: '2025-01-15T10:01:00.000Z',
      success: true,
      summary: 'OK',
      costUsd: 0.02,
      numTurns: 2,
    };

    writeRunLog('testproj', record);
    writeRunLog('testproj', record);

    const logsDir = join(tmpDir, 'testproj', 'logs');
    const files = readdirSync(logsDir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(2);
    expect(files[0]).not.toBe(files[1]);
  });
});
