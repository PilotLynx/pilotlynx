import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/project.js', () => ({
  listProjects: vi.fn(),
}));

vi.mock('../../src/lib/observation.js', () => ({
  getRecentLogs: vi.fn(),
  getLogStatistics: vi.fn(),
  writeStructuredInsights: vi.fn(),
  readRecentInsights: vi.fn(),
  writeSharedPattern: vi.fn(),
  writeAntiPattern: vi.fn(),
  writeFeedbackLog: vi.fn(),
  readFeedbackLog: vi.fn(),
}));

vi.mock('../../src/lib/agent-runner.js', () => ({
  runAgent: vi.fn(),
}));

vi.mock('../../src/lib/secrets.js', () => ({
  buildProjectEnv: vi.fn(),
}));

vi.mock('../../src/lib/config.js', () => ({
  getProjectDir: vi.fn(),
  INSIGHTS_DIR: vi.fn(() => '/tmp/test-insights'),
}));

vi.mock('../../src/lib/policy.js', () => ({
  resetPolicyCache: vi.fn(),
}));

vi.mock('../../src/agents/improve.agent.js', () => ({
  getImproveAgentConfig: vi.fn(),
}));

vi.mock('../../src/agents/run.agent.js', () => ({
  getRunAgentConfig: vi.fn(),
}));

vi.mock('../../src/lib/schedule.js', () => ({
  loadImproveState: vi.fn(() => ({ lastRun: null, projectFailures: {} })),
  saveImproveState: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    cpSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    readFileSync: vi.fn(() => ''),
    writeFileSync: vi.fn(),
  };
});

import { executeImprove, executeRevert } from '../../src/lib/command-ops/improve-ops.js';
import { listProjects } from '../../src/lib/project.js';
import { getRecentLogs, readRecentInsights, readFeedbackLog } from '../../src/lib/observation.js';
import { runAgent } from '../../src/lib/agent-runner.js';
import { buildProjectEnv } from '../../src/lib/secrets.js';
import { getProjectDir } from '../../src/lib/config.js';
import { getImproveAgentConfig } from '../../src/agents/improve.agent.js';
import { getRunAgentConfig } from '../../src/agents/run.agent.js';
import { existsSync, mkdirSync, cpSync } from 'node:fs';
import type { ProjectFeedback } from '../../src/agents/improve.agent.js';

function makeFeedback(overrides?: Partial<ProjectFeedback>): ProjectFeedback {
  return {
    summary: 'Test feedback',
    priority: 'medium',
    actionItems: ['Do something'],
    ...overrides,
  };
}

describe('improve snapshots and revert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readRecentInsights).mockReturnValue([]);
    vi.mocked(readFeedbackLog).mockReturnValue([]);
  });

  describe('createSnapshot (called during feedback dispatch)', () => {
    it('creates backup before dispatching feedback', async () => {
      vi.mocked(listProjects).mockReturnValue(['app1']);
      vi.mocked(getRecentLogs).mockReturnValue([
        { project: 'app1', workflow: 'daily', startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(), success: true, summary: 'OK',
          costUsd: 0.01, numTurns: 1 },
      ]);
      vi.mocked(getImproveAgentConfig).mockReturnValue({ prompt: 'improve' } as any);
      vi.mocked(getProjectDir).mockReturnValue('/tmp/app1');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(buildProjectEnv).mockReturnValue({});
      vi.mocked(getRunAgentConfig).mockReturnValue({ prompt: 'feedback' } as any);

      vi.mocked(runAgent)
        .mockResolvedValueOnce({
          success: true,
          result: 'Feedback',
          structuredOutput: {
            projectFeedback: { app1: makeFeedback() },
            crossProjectInsights: [],
          },
          costUsd: 0.02,
          durationMs: 1000,
          numTurns: 1,
        })
        .mockResolvedValueOnce({
          success: true,
          result: 'Applied',
          costUsd: 0.01,
          durationMs: 500,
          numTurns: 1,
        });

      await executeImprove();

      // mkdirSync should be called for the backup directory
      expect(mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.improve-backup'),
        expect.objectContaining({ recursive: true }),
      );
      // cpSync should be called for each existing target
      expect(cpSync).toHaveBeenCalled();
    });
  });

  describe('executeRevert', () => {
    it('returns error when no backup exists', async () => {
      vi.mocked(getProjectDir).mockReturnValue('/tmp/app1');
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await executeRevert('app1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No backup found');
    });

    it('restores files from backup directory', async () => {
      vi.mocked(getProjectDir).mockReturnValue('/tmp/app1');
      // First call: backupDir exists; subsequent calls: each target file exists
      vi.mocked(existsSync).mockReturnValue(true);

      const result = await executeRevert('app1');

      expect(result.success).toBe(true);
      // cpSync called for each of the 4 targets (CLAUDE.md, memory, skills, rules)
      expect(cpSync).toHaveBeenCalledTimes(4);
      expect(cpSync).toHaveBeenCalledWith(
        expect.stringContaining('CLAUDE.md'),
        expect.stringContaining('CLAUDE.md'),
        expect.objectContaining({ recursive: true, force: true }),
      );
    });

    it('returns error when backup dir exists but has no recognized files', async () => {
      vi.mocked(getProjectDir).mockReturnValue('/tmp/app1');
      // backupDir exists, but individual target files do not
      vi.mocked(existsSync).mockImplementation((path: any) => {
        const p = String(path);
        return p.includes('.improve-backup') && !p.includes('CLAUDE.md') && !p.includes('memory') && !p.includes('skills') && !p.includes('rules');
      });

      const result = await executeRevert('app1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('no recognized files');
    });
  });
});
