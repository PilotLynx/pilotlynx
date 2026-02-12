import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/project.js', () => ({
  projectExists: vi.fn(),
}));

vi.mock('../../../src/lib/config.js', () => ({
  getProjectDir: vi.fn(),
}));

vi.mock('../../../src/lib/secrets.js', () => ({
  buildProjectEnv: vi.fn(),
}));

vi.mock('../../../src/lib/agent-runner.js', () => ({
  runAgent: vi.fn(),
}));

vi.mock('../../../src/lib/logger.js', () => ({
  writeRunLog: vi.fn(),
}));

vi.mock('../../../src/agents/run.agent.js', () => ({
  getRunAgentConfig: vi.fn(),
}));

vi.mock('../../../src/lib/validation.js', () => ({
  validateWorkflowName: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: vi.fn() };
});

import { executeRun } from '../../../src/lib/command-ops/run-ops.js';
import { projectExists } from '../../../src/lib/project.js';
import { getProjectDir } from '../../../src/lib/config.js';
import { buildProjectEnv } from '../../../src/lib/secrets.js';
import { runAgent } from '../../../src/lib/agent-runner.js';
import { writeRunLog } from '../../../src/lib/logger.js';
import { getRunAgentConfig } from '../../../src/agents/run.agent.js';
import { validateWorkflowName } from '../../../src/lib/validation.js';
import { existsSync } from 'node:fs';

describe('run-ops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when project does not exist', async () => {
    vi.mocked(projectExists).mockReturnValue(false);

    const result = await executeRun('ghost', 'daily_check');

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not exist');
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('throws on invalid workflow name', async () => {
    vi.mocked(projectExists).mockReturnValue(true);
    vi.mocked(validateWorkflowName).mockImplementation(() => {
      throw new Error('Invalid workflow name "../escape"');
    });

    await expect(executeRun('myapp', '../escape')).rejects.toThrow('Invalid workflow name');
  });

  it('returns error when workflow file not found', async () => {
    vi.mocked(projectExists).mockReturnValue(true);
    vi.mocked(validateWorkflowName).mockImplementation(() => {});
    vi.mocked(getProjectDir).mockReturnValue('/tmp/myapp');
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await executeRun('myapp', 'nonexistent');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('executes agent and writes log on success', async () => {
    vi.mocked(projectExists).mockReturnValue(true);
    vi.mocked(validateWorkflowName).mockImplementation(() => {});
    vi.mocked(getProjectDir).mockReturnValue('/tmp/myapp');
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(buildProjectEnv).mockReturnValue({ API_KEY: 'test' });
    const fakeConfig = { prompt: 'run' };
    vi.mocked(getRunAgentConfig).mockReturnValue(fakeConfig as any);
    vi.mocked(runAgent).mockResolvedValue({
      success: true,
      result: 'Completed daily check',
      costUsd: 0.05,
      durationMs: 3000,
      numTurns: 4,
    });

    const result = await executeRun('myapp', 'daily_check');

    expect(result.success).toBe(true);
    expect(result.costUsd).toBe(0.05);
    expect(result.numTurns).toBe(4);
    expect(result.record).toBeDefined();
    expect(result.record!.project).toBe('myapp');
    expect(result.record!.workflow).toBe('daily_check');
    expect(result.record!.success).toBe(true);
    expect(writeRunLog).toHaveBeenCalledWith('myapp', expect.objectContaining({
      project: 'myapp',
      workflow: 'daily_check',
      success: true,
    }));
  });

  it('writes log and returns error on agent failure', async () => {
    vi.mocked(projectExists).mockReturnValue(true);
    vi.mocked(validateWorkflowName).mockImplementation(() => {});
    vi.mocked(getProjectDir).mockReturnValue('/tmp/myapp');
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(buildProjectEnv).mockReturnValue({});
    vi.mocked(getRunAgentConfig).mockReturnValue({ prompt: 'run' } as any);
    vi.mocked(runAgent).mockResolvedValue({
      success: false,
      result: 'Agent crashed',
      costUsd: 0.01,
      durationMs: 500,
      numTurns: 1,
    });

    const result = await executeRun('myapp', 'daily_check');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Agent crashed');
    expect(result.record).toBeDefined();
    expect(writeRunLog).toHaveBeenCalled();
  });

  it('returns error when agent throws', async () => {
    vi.mocked(projectExists).mockReturnValue(true);
    vi.mocked(validateWorkflowName).mockImplementation(() => {});
    vi.mocked(getProjectDir).mockReturnValue('/tmp/myapp');
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(buildProjectEnv).mockReturnValue({});
    vi.mocked(getRunAgentConfig).mockReturnValue({ prompt: 'run' } as any);
    vi.mocked(runAgent).mockRejectedValue(new Error('Network timeout'));

    const result = await executeRun('myapp', 'daily_check');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network timeout');
    expect(writeRunLog).not.toHaveBeenCalled();
  });

  it('passes feedback prompt to agent config', async () => {
    vi.mocked(projectExists).mockReturnValue(true);
    vi.mocked(validateWorkflowName).mockImplementation(() => {});
    vi.mocked(getProjectDir).mockReturnValue('/tmp/myapp');
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(buildProjectEnv).mockReturnValue({});
    vi.mocked(getRunAgentConfig).mockReturnValue({ prompt: 'run' } as any);
    vi.mocked(runAgent).mockResolvedValue({
      success: true,
      result: 'Done',
      costUsd: 0.02,
      durationMs: 1000,
      numTurns: 2,
    });

    await executeRun('myapp', 'daily_check', 'Improve error handling');

    expect(getRunAgentConfig).toHaveBeenCalledWith(
      'myapp',
      'daily_check',
      expect.any(Object),
      'Improve error handling',
    );
  });

  it('includes token usage in record when available', async () => {
    vi.mocked(projectExists).mockReturnValue(true);
    vi.mocked(validateWorkflowName).mockImplementation(() => {});
    vi.mocked(getProjectDir).mockReturnValue('/tmp/myapp');
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(buildProjectEnv).mockReturnValue({});
    vi.mocked(getRunAgentConfig).mockReturnValue({ prompt: 'run' } as any);
    vi.mocked(runAgent).mockResolvedValue({
      success: true,
      result: 'Done',
      costUsd: 0.10,
      durationMs: 5000,
      numTurns: 6,
      inputTokens: 1000,
      outputTokens: 500,
      model: 'claude-sonnet-4-5-20250929',
    });

    const result = await executeRun('myapp', 'daily_check');

    expect(result.record!.inputTokens).toBe(1000);
    expect(result.record!.outputTokens).toBe(500);
    expect(result.record!.model).toBe('claude-sonnet-4-5-20250929');
  });
});
