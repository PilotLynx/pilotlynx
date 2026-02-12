import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/project.js', () => ({
  projectExists: vi.fn(),
}));

vi.mock('../../../src/lib/agent-runner.js', () => ({
  runAgent: vi.fn(),
}));

vi.mock('../../../src/agents/sync-template.agent.js', () => ({
  getSyncTemplateAgentConfig: vi.fn(),
}));

import { executeSyncTemplate } from '../../../src/lib/command-ops/sync-ops.js';
import { projectExists } from '../../../src/lib/project.js';
import { runAgent } from '../../../src/lib/agent-runner.js';
import { getSyncTemplateAgentConfig } from '../../../src/agents/sync-template.agent.js';

describe('sync-ops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when project does not exist', async () => {
    vi.mocked(projectExists).mockReturnValue(false);

    const result = await executeSyncTemplate('missing-proj');

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not exist');
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('calls agent and returns success on agent success', async () => {
    vi.mocked(projectExists).mockReturnValue(true);
    const fakeConfig = { prompt: 'sync' };
    vi.mocked(getSyncTemplateAgentConfig).mockReturnValue(fakeConfig as any);
    vi.mocked(runAgent).mockResolvedValue({
      success: true,
      result: 'Synced',
      costUsd: 0.01,
      durationMs: 500,
      numTurns: 1,
    });

    const result = await executeSyncTemplate('myapp');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(getSyncTemplateAgentConfig).toHaveBeenCalledWith('myapp');
    expect(runAgent).toHaveBeenCalledWith(fakeConfig);
  });

  it('returns error on agent failure', async () => {
    vi.mocked(projectExists).mockReturnValue(true);
    vi.mocked(getSyncTemplateAgentConfig).mockReturnValue({ prompt: 'sync' } as any);
    vi.mocked(runAgent).mockResolvedValue({
      success: false,
      result: 'Template mismatch',
      costUsd: 0,
      durationMs: 100,
      numTurns: 1,
    });

    const result = await executeSyncTemplate('myapp');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Template mismatch');
  });
});
