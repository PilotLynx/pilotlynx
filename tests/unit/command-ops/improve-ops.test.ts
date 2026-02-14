import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/project.js', () => ({
  listProjects: vi.fn(),
}));

vi.mock('../../../src/lib/observation.js', () => ({
  getRecentLogs: vi.fn(),
  getLogStatistics: vi.fn(),
  writeInsight: vi.fn(),
  writeStructuredInsights: vi.fn(),
  readRecentInsights: vi.fn(),
  writeSharedPattern: vi.fn(),
  writeAntiPattern: vi.fn(),
  writeFeedbackLog: vi.fn(),
  readFeedbackLog: vi.fn(),
}));

vi.mock('../../../src/lib/agent-runner.js', () => ({
  runAgent: vi.fn(),
}));

vi.mock('../../../src/lib/secrets.js', () => ({
  buildProjectEnv: vi.fn(),
}));

vi.mock('../../../src/lib/config.js', () => ({
  getProjectDir: vi.fn(),
  INSIGHTS_DIR: vi.fn(() => '/tmp/test-insights'),
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

vi.mock('../../../src/lib/logger.js', () => ({
  writeRunLog: vi.fn(),
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

import { executeImprove } from '../../../src/lib/command-ops/improve-ops.js';
import { listProjects } from '../../../src/lib/project.js';
import { getRecentLogs, writeStructuredInsights, readRecentInsights, writeFeedbackLog, readFeedbackLog } from '../../../src/lib/observation.js';
import { runAgent } from '../../../src/lib/agent-runner.js';
import { buildProjectEnv } from '../../../src/lib/secrets.js';
import { getProjectDir } from '../../../src/lib/config.js';
import { getImproveAgentConfig } from '../../../src/agents/improve.agent.js';
import { getRunAgentConfig } from '../../../src/agents/run.agent.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { ProjectFeedback } from '../../../src/agents/improve.agent.js';

function makeFeedback(overrides?: Partial<ProjectFeedback>): ProjectFeedback {
  return {
    summary: 'Test feedback',
    priority: 'medium',
    actionItems: ['Do something'],
    ...overrides,
  };
}

describe('improve-ops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readRecentInsights).mockReturnValue([]);
    vi.mocked(readFeedbackLog).mockReturnValue([]);
  });

  it('returns noProjects when no projects exist', async () => {
    vi.mocked(listProjects).mockReturnValue([]);

    const result = await executeImprove();

    expect(result.success).toBe(true);
    expect(result.noProjects).toBe(true);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('returns noActivity when no recent logs and no bootstrap targets', async () => {
    vi.mocked(listProjects).mockReturnValue(['app1']);
    vi.mocked(getRecentLogs).mockReturnValue([]);
    vi.mocked(getProjectDir).mockReturnValue('/tmp/app1');
    // existsSync: briefPath exists, skillsDir exists (so hasNoSkills depends on readdirSync)
    vi.mocked(existsSync).mockReturnValue(true);
    // readdirSync returns .md files for skills dir so hasNoSkills=false
    vi.mocked(readdirSync).mockReturnValue(['existing-skill.md'] as any);
    // readFileSync returns non-template content so hasDefaultBrief=false (must be >200 chars with no template markers)
    vi.mocked(readFileSync).mockReturnValue('This is a real project brief with specific goals and meaningful content that has been carefully written by the project owner. It describes the architecture, key decisions, deployment strategy, testing approach, and all the important details that make this a fully configured and active project in the workspace.');

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

  it('dispatches structured feedback to projects with daily_feedback workflow', async () => {
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
          projectFeedback: { app1: makeFeedback({ summary: 'Improve error handling' }) },
          crossProjectInsights: [
            { id: 'ins-001', category: 'reliability', insight: 'Add retries', actionable: true, evidence: 'data' },
          ],
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
    expect(writeStructuredInsights).toHaveBeenCalled();
    expect(writeFeedbackLog).toHaveBeenCalled();
    expect(result.totalCostUsd).toBe(0.08);
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
        projectFeedback: { app1: makeFeedback() },
        crossProjectInsights: [],
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
          projectFeedback: { app1: makeFeedback({ summary: 'Fix bugs' }) },
          crossProjectInsights: [],
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

  it('skips projects with empty feedback summary', async () => {
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
        projectFeedback: { app1: makeFeedback({ summary: '' }) },
        crossProjectInsights: [],
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

  it('supports dry-run mode', async () => {
    vi.mocked(listProjects).mockReturnValue(['app1']);
    vi.mocked(getRecentLogs).mockReturnValue([
      { project: 'app1', workflow: 'daily', startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(), success: true, summary: 'OK',
        costUsd: 0.01, numTurns: 1 },
    ]);
    vi.mocked(getImproveAgentConfig).mockReturnValue({ prompt: 'improve' } as any);

    const mockOutput = {
      projectFeedback: { app1: makeFeedback({ priority: 'high', actionItems: ['Fix errors'] }) },
      crossProjectInsights: [
        { id: 'ins-001', category: 'cost', insight: 'Optimize', actionable: true, evidence: 'data' },
      ],
    };

    vi.mocked(runAgent).mockResolvedValueOnce({
      success: true,
      result: 'Analysis complete',
      structuredOutput: mockOutput,
      costUsd: 0.05,
      durationMs: 2000,
      numTurns: 3,
    });

    const result = await executeImprove({ dryRun: true });

    expect(result.success).toBe(true);
    expect(result.dryRunOutput).toBeDefined();
    expect(result.dryRunOutput!.projectFeedback.app1.priority).toBe('high');
    expect(result.totalCostUsd).toBe(0.05);
    // Should NOT dispatch feedback agents
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it('uses configurable days parameter', async () => {
    vi.mocked(listProjects).mockReturnValue(['app1']);
    vi.mocked(getRecentLogs).mockReturnValue([]);
    vi.mocked(getProjectDir).mockReturnValue('/tmp/app1');
    vi.mocked(existsSync).mockReturnValue(false);

    await executeImprove({ days: 14 });

    expect(getRecentLogs).toHaveBeenCalledWith('app1', 14);
  });

  it('passes previous insights to improve agent', async () => {
    vi.mocked(listProjects).mockReturnValue(['app1']);
    vi.mocked(getRecentLogs).mockReturnValue([
      { project: 'app1', workflow: 'daily', startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(), success: true, summary: 'OK',
        costUsd: 0.01, numTurns: 1 },
    ]);
    vi.mocked(readRecentInsights).mockReturnValue([
      { id: 'ins-001', category: 'cost', insight: 'Reduce token usage', actionable: true, evidence: 'data', date: '2025-01-01' },
    ]);
    vi.mocked(getImproveAgentConfig).mockReturnValue({ prompt: 'improve' } as any);
    vi.mocked(runAgent).mockResolvedValueOnce({
      success: true, result: '', structuredOutput: null, costUsd: 0, durationMs: 0, numTurns: 0,
    });

    await executeImprove();

    // Verify getImproveAgentConfig was called with previous insights string
    expect(getImproveAgentConfig).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining('Reduce token usage'),
    );
  });
});
