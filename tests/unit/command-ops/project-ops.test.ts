import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/project.js', () => ({
  createProjectFromTemplate: vi.fn(),
  addScaffolding: vi.fn(),
}));

vi.mock('../../../src/lib/registry.js', () => ({
  isRegistered: vi.fn(),
  registerProject: vi.fn(),
}));

vi.mock('../../../src/lib/config.js', () => ({
  getConfigRoot: vi.fn(),
  ENV_FILE: vi.fn(),
}));

vi.mock('../../../src/lib/agent-runner.js', () => ({
  runAgent: vi.fn(),
}));

vi.mock('../../../src/agents/project-create.agent.js', () => ({
  getProjectCreateAgentConfig: vi.fn(),
}));

vi.mock('../../../src/agents/project-add.agent.js', () => ({
  getProjectAddAgentConfig: vi.fn(),
}));

vi.mock('../../../src/lib/validation.js', () => ({
  validateProjectName: vi.fn(),
}));

vi.mock('../../../src/lib/command-ops/secrets-migration-ops.js', () => ({
  executeSecretsMigration: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: vi.fn(), statSync: vi.fn(), readFileSync: vi.fn() };
});

import {
  executeProjectCreate,
  executeProjectAdd,
} from '../../../src/lib/command-ops/project-ops.js';
import { createProjectFromTemplate, addScaffolding } from '../../../src/lib/project.js';
import { isRegistered, registerProject } from '../../../src/lib/registry.js';
import { getConfigRoot, ENV_FILE } from '../../../src/lib/config.js';
import { runAgent } from '../../../src/lib/agent-runner.js';
import { getProjectCreateAgentConfig } from '../../../src/agents/project-create.agent.js';
import { getProjectAddAgentConfig } from '../../../src/agents/project-add.agent.js';
import { validateProjectName } from '../../../src/lib/validation.js';
import { executeSecretsMigration } from '../../../src/lib/command-ops/secrets-migration-ops.js';
import { existsSync, statSync, readFileSync } from 'node:fs';

describe('project-ops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executeProjectCreate', () => {
    it('throws on invalid project name', async () => {
      vi.mocked(validateProjectName).mockImplementation(() => {
        throw new Error('"pilotlynx" is reserved');
      });

      await expect(
        executeProjectCreate('pilotlynx', ['API_KEY'], 'version: 1'),
      ).rejects.toThrow('reserved');
    });

    it('creates project from template and runs agent', async () => {
      vi.mocked(validateProjectName).mockImplementation(() => {});
      vi.mocked(createProjectFromTemplate).mockImplementation(() => {});
      const fakeConfig = { prompt: 'create' };
      vi.mocked(getProjectCreateAgentConfig).mockReturnValue(fakeConfig as any);
      vi.mocked(runAgent).mockResolvedValue({
        success: true,
        result: 'Project created',
        costUsd: 0.05,
        durationMs: 2000,
        numTurns: 3,
      });

      const result = await executeProjectCreate('myapp', ['API_KEY'], 'version: 1');

      expect(result.success).toBe(true);
      expect(createProjectFromTemplate).toHaveBeenCalledWith('myapp');
      expect(getProjectCreateAgentConfig).toHaveBeenCalledWith('myapp', ['API_KEY'], 'version: 1');
      expect(runAgent).toHaveBeenCalledWith(fakeConfig);
    });

    it('returns error when agent fails', async () => {
      vi.mocked(validateProjectName).mockImplementation(() => {});
      vi.mocked(createProjectFromTemplate).mockImplementation(() => {});
      vi.mocked(getProjectCreateAgentConfig).mockReturnValue({ prompt: 'create' } as any);
      vi.mocked(runAgent).mockResolvedValue({
        success: false,
        result: 'Failed to configure project',
        costUsd: 0.01,
        durationMs: 500,
        numTurns: 1,
      });

      const result = await executeProjectCreate('myapp', [], '');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to configure project');
    });
  });

  describe('executeProjectAdd', () => {
    it('returns error when target directory does not exist', async () => {
      vi.mocked(validateProjectName).mockImplementation(() => {});
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await executeProjectAdd('myapp', '/nonexistent', [], '');

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
    });

    it('returns error when target is the config directory', async () => {
      vi.mocked(validateProjectName).mockImplementation(() => {});
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.mocked(getConfigRoot).mockReturnValue('/workspace/pilotlynx');

      const result = await executeProjectAdd('myapp', '/workspace/pilotlynx', [], '');

      expect(result.success).toBe(false);
      expect(result.error).toContain('config directory');
    });

    it('returns error when project is already registered', async () => {
      vi.mocked(validateProjectName).mockImplementation(() => {});
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.mocked(getConfigRoot).mockReturnValue('/workspace/pilotlynx');
      vi.mocked(isRegistered).mockReturnValue(true);

      const result = await executeProjectAdd('myapp', '/workspace/myapp', [], '');

      expect(result.success).toBe(false);
      expect(result.error).toContain('already registered');
    });

    it('adds scaffolding, registers, migrates secrets, and runs agent', async () => {
      vi.mocked(validateProjectName).mockImplementation(() => {});
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.mocked(getConfigRoot).mockReturnValue('/workspace/pilotlynx');
      vi.mocked(isRegistered).mockReturnValue(false);
      vi.mocked(addScaffolding).mockReturnValue({
        added: ['CLAUDE.md', 'workflows/'],
        skipped: ['PROJECT_BRIEF.md'],
      });
      vi.mocked(registerProject).mockImplementation(() => {});
      vi.mocked(executeSecretsMigration).mockResolvedValue({
        migrated: false,
        summary: 'No secrets found',
      } as any);
      const fakeConfig = { prompt: 'add' };
      vi.mocked(getProjectAddAgentConfig).mockReturnValue(fakeConfig as any);
      vi.mocked(runAgent).mockResolvedValue({
        success: true,
        result: 'Project configured',
        costUsd: 0.03,
        durationMs: 1500,
        numTurns: 2,
      });

      const result = await executeProjectAdd(
        'myapp', '/workspace/myapp', ['API_KEY'], 'version: 1',
      );

      expect(result.success).toBe(true);
      expect(result.added).toEqual(['CLAUDE.md', 'workflows/']);
      expect(result.skipped).toEqual(['PROJECT_BRIEF.md']);
      expect(addScaffolding).toHaveBeenCalled();
      expect(registerProject).toHaveBeenCalled();
      expect(executeSecretsMigration).toHaveBeenCalled();
      expect(runAgent).toHaveBeenCalledWith(fakeConfig);
    });

    it('re-reads env keys after secrets migration', async () => {
      vi.mocked(validateProjectName).mockImplementation(() => {});
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.mocked(getConfigRoot).mockReturnValue('/workspace/pilotlynx');
      vi.mocked(isRegistered).mockReturnValue(false);
      vi.mocked(addScaffolding).mockReturnValue({ added: [], skipped: [] });
      vi.mocked(registerProject).mockImplementation(() => {});
      vi.mocked(executeSecretsMigration).mockResolvedValue({
        migrated: true,
        summary: 'Migrated 2 secrets',
      } as any);
      vi.mocked(ENV_FILE).mockReturnValue('/workspace/pilotlynx/.env');
      vi.mocked(readFileSync).mockReturnValue(
        'API_KEY=sk-test\nDATABASE_URL=postgres://localhost\n# comment\n',
      );
      vi.mocked(getProjectAddAgentConfig).mockReturnValue({ prompt: 'add' } as any);
      vi.mocked(runAgent).mockResolvedValue({
        success: true,
        result: 'Done',
        costUsd: 0.02,
        durationMs: 1000,
        numTurns: 1,
      });

      await executeProjectAdd('myapp', '/workspace/myapp', ['OLD_KEY'], 'version: 1');

      // Should pass re-read keys (API_KEY, DATABASE_URL) instead of original (OLD_KEY)
      expect(getProjectAddAgentConfig).toHaveBeenCalledWith(
        'myapp',
        ['API_KEY', 'DATABASE_URL'],
        'version: 1',
        'Migrated 2 secrets',
      );
    });

    it('returns error with scaffolding info when agent fails', async () => {
      vi.mocked(validateProjectName).mockImplementation(() => {});
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.mocked(getConfigRoot).mockReturnValue('/workspace/pilotlynx');
      vi.mocked(isRegistered).mockReturnValue(false);
      vi.mocked(addScaffolding).mockReturnValue({ added: ['CLAUDE.md'], skipped: [] });
      vi.mocked(registerProject).mockImplementation(() => {});
      vi.mocked(executeSecretsMigration).mockResolvedValue({
        migrated: false,
        summary: '',
      } as any);
      vi.mocked(getProjectAddAgentConfig).mockReturnValue({ prompt: 'add' } as any);
      vi.mocked(runAgent).mockResolvedValue({
        success: false,
        result: 'Agent failed to configure',
        costUsd: 0,
        durationMs: 100,
        numTurns: 0,
      });

      const result = await executeProjectAdd('myapp', '/workspace/myapp', [], '');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Agent failed to configure');
      expect(result.added).toEqual(['CLAUDE.md']);
    });
  });
});
