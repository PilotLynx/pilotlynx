import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/project.js', () => ({
  listProjects: vi.fn(),
}));

vi.mock('../../../src/lib/observation.js', () => ({
  getRecentLogs: vi.fn(),
  writeInsight: vi.fn(),
}));

vi.mock('../../../src/lib/agent-runner.js', () => ({
  runAgent: vi.fn(),
}));

vi.mock('../../../src/lib/secrets.js', () => ({
  buildProjectEnv: vi.fn(),
}));

vi.mock('../../../src/lib/config.js', () => ({
  getProjectDir: vi.fn(),
}));

vi.mock('../../../src/lib/policy.js', () => ({
  resetPolicyCache: vi.fn(),
}));

vi.mock('../../../src/agents/improve.agent.js', () => ({
  getImproveAgentConfig: vi.fn(),
}));

vi.mock('../../../src/agents/run.agent.js', () => ({
  getRunAgentConfig: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: vi.fn() };
});

import { executeImprove } from '../../../src/lib/command-ops/improve-ops.js';
import { listProjects } from '../../../src/lib/project.js';
import { getRecentLogs, writeInsight } from '../../../src/lib/observation.js';
import { runAgent } from '../../../src/lib/agent-runner.js';
import { buildProjectEnv } from '../../../src/lib/secrets.js';
import { getProjectDir } from '../../../src/lib/config.js';
import { getImproveAgentConfig } from '../../../src/agents/improve.agent.js';
import { getRunAgentConfig } from '../../../src/agents/run.agent.js';
import { existsSync } from 'node:fs';

describe('improve-ops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns noProjects when no projects exist', async () => {
    vi.mocked(listProjects).mockReturnValue([]);

    const result = await executeImprove();

    expect(result.success).toBe(true);
    expect(result.noProjects).toBe(true);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('returns noActivity when no recent logs exist', async () => {
    vi.mocked(listProjects).mockReturnValue(['app1']);
    vi.mocked(getRecentLogs).mockReturnValue([]);

    const result = await executeImprove();

    expect(result.success).toBe(true);
    expect(result.noActivity).toBe(true);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('returns noFeedback when agent returns no structured output', async () => {
    vi.mocked(listProjects).mockReturnValue(['app1']);
    vi.mocked(getRecentLogs).mockReturnValue([
      { project: 'app1', workflow: 'daily', startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(), success: true, summary: 'OK',
        costUsd: 0.01, numTurns: 1 },
    ]);
    vi.mocked(getImproveAgentConfig).mockReturnValue({ prompt: 'improve' } as any);
    vi.mocked(runAgent).mockResolvedValue({
      success: true,
      result: 'No improvements needed',
      structuredOutput: null,
      costUsd: 0.02,
      durationMs: 1000,
      numTurns: 1,
    });

    const result = await executeImprove();

    expect(result.success).toBe(true);
    expect(result.noFeedback).toBe(true);
  });

  it('returns error when improve agent fails', async () => {
    vi.mocked(listProjects).mockReturnValue(['app1']);
    vi.mocked(getRecentLogs).mockReturnValue([
      { project: 'app1', workflow: 'daily', startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(), success: true, summary: 'OK',
        costUsd: 0.01, numTurns: 1 },
    ]);
    vi.mocked(getImproveAgentConfig).mockReturnValue({ prompt: 'improve' } as any);
    vi.mocked(runAgent).mockResolvedValue({
      success: false,
      result: 'API rate limited',
      costUsd: 0,
      durationMs: 200,
      numTurns: 0,
    });

    const result = await executeImprove();

    expect(result.success).toBe(false);
    expect(result.error).toBe('API rate limited');
  });

  it('returns error when improve agent throws', async () => {
    vi.mocked(listProjects).mockReturnValue(['app1']);
    vi.mocked(getRecentLogs).mockReturnValue([
      { project: 'app1', workflow: 'daily', startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(), success: true, summary: 'OK',
        costUsd: 0.01, numTurns: 1 },
    ]);
    vi.mocked(getImproveAgentConfig).mockReturnValue({ prompt: 'improve' } as any);
    vi.mocked(runAgent).mockRejectedValue(new Error('Connection refused'));

    const result = await executeImprove();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection refused');
  });

  it('dispatches feedback to projects with daily_feedback workflow', async () => {
    vi.mocked(listProjects).mockReturnValue(['app1', 'app2']);
    vi.mocked(getRecentLogs).mockImplementation((project) => {
      if (project === 'app1') {
        return [{ project: 'app1', workflow: 'daily', startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(), success: true, summary: 'OK',
          costUsd: 0.01, numTurns: 1 }];
      }
      return [];
    });
    vi.mocked(getImproveAgentConfig).mockReturnValue({ prompt: 'improve' } as any);
    vi.mocked(getProjectDir).mockReturnValue('/tmp/app1');
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(buildProjectEnv).mockReturnValue({ API_KEY: 'test' });
    vi.mocked(getRunAgentConfig).mockReturnValue({ prompt: 'feedback' } as any);

    // First call = improve agent, second = feedback agent
    vi.mocked(runAgent)
      .mockResolvedValueOnce({
        success: true,
        result: 'Improvements found',
        structuredOutput: {
          projectFeedback: { app1: 'Improve error handling' },
          crossProjectInsights: 'All projects should add retries',
        },
        costUsd: 0.05,
        durationMs: 3000,
        numTurns: 3,
      })
      .mockResolvedValueOnce({
        success: true,
        result: 'Feedback applied',
        costUsd: 0.03,
        durationMs: 2000,
        numTurns: 2,
      });

    const result = await executeImprove();

    expect(result.success).toBe(true);
    expect(result.failures).toBeUndefined();
    expect(runAgent).toHaveBeenCalledTimes(2);
    expect(writeInsight).toHaveBeenCalledWith('All projects should add retries');
  });

  it('skips projects without daily_feedback workflow', async () => {
    vi.mocked(listProjects).mockReturnValue(['app1']);
    vi.mocked(getRecentLogs).mockReturnValue([
      { project: 'app1', workflow: 'daily', startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(), success: true, summary: 'OK',
        costUsd: 0.01, numTurns: 1 },
    ]);
    vi.mocked(getImproveAgentConfig).mockReturnValue({ prompt: 'improve' } as any);
    vi.mocked(getProjectDir).mockReturnValue('/tmp/app1');
    vi.mocked(existsSync).mockReturnValue(false); // no daily_feedback workflow

    vi.mocked(runAgent).mockResolvedValueOnce({
      success: true,
      result: 'Found feedback',
      structuredOutput: {
        projectFeedback: { app1: 'Some feedback' },
        crossProjectInsights: '',
      },
      costUsd: 0.02,
      durationMs: 1000,
      numTurns: 1,
    });

    const result = await executeImprove();

    expect(result.success).toBe(true);
    // Only the improve agent should have been called, not the feedback agent
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it('collects failures from project feedback agents', async () => {
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
          projectFeedback: { app1: 'Fix bugs' },
          crossProjectInsights: '',
        },
        costUsd: 0.02,
        durationMs: 1000,
        numTurns: 1,
      })
      .mockResolvedValueOnce({
        success: false,
        result: 'Agent timed out',
        costUsd: 0,
        durationMs: 30000,
        numTurns: 0,
      });

    const result = await executeImprove();

    expect(result.success).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures![0].project).toBe('app1');
    expect(result.failures![0].error).toBe('Agent timed out');
  });

  it('skips projects with empty feedback', async () => {
    vi.mocked(listProjects).mockReturnValue(['app1']);
    vi.mocked(getRecentLogs).mockReturnValue([
      { project: 'app1', workflow: 'daily', startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(), success: true, summary: 'OK',
        costUsd: 0.01, numTurns: 1 },
    ]);
    vi.mocked(getImproveAgentConfig).mockReturnValue({ prompt: 'improve' } as any);

    vi.mocked(runAgent).mockResolvedValueOnce({
      success: true,
      result: 'No issues',
      structuredOutput: {
        projectFeedback: { app1: '' }, // empty feedback
        crossProjectInsights: '',
      },
      costUsd: 0.02,
      durationMs: 1000,
      numTurns: 1,
    });

    const result = await executeImprove();

    expect(result.success).toBe(true);
    // Only the improve agent should have been called
    expect(runAgent).toHaveBeenCalledTimes(1);
  });
});
