import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../src/lib/config.js';
import { resetRegistryCache, registerProject } from '../../src/lib/registry.js';
import { getRecentLogs } from '../../src/lib/observation.js';
import { writeRunLog } from '../../src/lib/logger.js';
import type { RunRecord } from '../../src/lib/types.js';

describe('token tracking in RunRecord', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pilotlynx-test-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    mkdirSync(configDir, { recursive: true });
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetRegistryCache();

    mkdirSync(join(tmpDir, 'testproj', 'logs'), { recursive: true });
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

  it('RunRecord supports optional token fields', () => {
    const record: RunRecord = {
      project: 'testproj',
      workflow: 'test',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      success: true,
      summary: 'OK',
      costUsd: 0.01,
      numTurns: 3,
      inputTokens: 1500,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheCreationTokens: 100,
      model: 'claude-sonnet-4-5-20250929',
    };

    expect(record.inputTokens).toBe(1500);
    expect(record.outputTokens).toBe(500);
    expect(record.cacheReadTokens).toBe(200);
    expect(record.cacheCreationTokens).toBe(100);
    expect(record.model).toBe('claude-sonnet-4-5-20250929');
  });

  it('RunRecord works without token fields (backward compat)', () => {
    const record: RunRecord = {
      project: 'testproj',
      workflow: 'test',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      success: true,
      summary: 'OK',
      costUsd: 0.01,
      numTurns: 3,
    };

    expect(record.inputTokens).toBeUndefined();
    expect(record.outputTokens).toBeUndefined();
    expect(record.model).toBeUndefined();
  });

  it('writes and reads RunRecord with token data', () => {
    const now = new Date();
    const record: RunRecord = {
      project: 'testproj',
      workflow: 'test_wf',
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      success: true,
      summary: 'OK',
      costUsd: 0.05,
      numTurns: 5,
      inputTokens: 2000,
      outputTokens: 800,
      model: 'claude-sonnet-4-5-20250929',
    };

    writeRunLog('testproj', record);

    const logs = getRecentLogs('testproj', 1);
    expect(logs).toHaveLength(1);
    expect(logs[0].inputTokens).toBe(2000);
    expect(logs[0].outputTokens).toBe(800);
    expect(logs[0].model).toBe('claude-sonnet-4-5-20250929');
  });

  it('reads legacy logs without token fields', () => {
    const logsDir = join(tmpDir, 'testproj', 'logs');
    const legacy = {
      project: 'testproj',
      workflow: 'old_run',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      success: true,
      summary: 'OK',
      costUsd: 0.01,
      numTurns: 2,
    };
    writeFileSync(join(logsDir, 'legacy.json'), JSON.stringify(legacy));

    const logs = getRecentLogs('testproj', 1);
    expect(logs).toHaveLength(1);
    expect(logs[0].inputTokens).toBeUndefined();
    expect(logs[0].model).toBeUndefined();
  });
});
