import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../../src/lib/config.js';
import { resetRegistryCache } from '../../../src/lib/registry.js';

// Mock agent runner
vi.mock('../../../src/lib/agent-runner.js', () => ({
  runAgent: vi.fn().mockResolvedValue({
    success: true,
    result: 'test result',
    structuredOutput: { reply: 'Hello from agent' },
    costUsd: 0.01,
    durationMs: 1000,
    numTurns: 3,
  }),
}));

// Mock prompts
vi.mock('../../../src/lib/prompts.js', () => ({
  loadPrompt: vi.fn().mockReturnValue('test prompt'),
  loadSystemPrompt: vi.fn().mockReturnValue('test system prompt'),
}));

import { runRelayChatAgent } from '../../../src/lib/relay/chat.js';
import { runAgent } from '../../../src/lib/agent-runner.js';

describe('relay chat', () => {
  let tmpDir: string;
  let configDir: string;
  let projectDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-relay-chat-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    projectDir = join(tmpDir, 'test-project');
    mkdirSync(configDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(configDir, 'plynx.yaml'), stringifyYaml({ version: 1, name: 'test' }));
    writeFileSync(join(configDir, '.env'), 'API_KEY=test\n');
    writeFileSync(join(configDir, 'projects.yaml'), stringifyYaml({
      version: 1,
      projects: { 'test-project': { path: projectDir } },
    }));
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetRegistryCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.PILOTLYNX_ROOT = origEnv;
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    resetRegistryCache();
  });

  it('returns reply from structured output', async () => {
    const result = await runRelayChatAgent('test-project', 'hello', []);
    expect(result).toBe('Hello from agent');
  });

  it('passes correct config to runAgent', async () => {
    await runRelayChatAgent('test-project', 'hello', []);
    const config = vi.mocked(runAgent).mock.calls[0][0];
    expect(config.allowedTools).toEqual(['Read', 'Glob', 'Grep']);
    expect(config.permissionMode).toBe('default');
    expect(config.maxTurns).toBe(15);
    expect(config.cwd).toBe(projectDir);
  });

  it('tool callback blocks .env access', async () => {
    await runRelayChatAgent('test-project', 'hello', []);
    const config = vi.mocked(runAgent).mock.calls[0][0];
    const canUseTool = config.canUseTool!;

    const envResult = await canUseTool('Read', { file_path: join(configDir, '.env') });
    expect(envResult.behavior).toBe('deny');
  });

  it('tool callback blocks paths outside project', async () => {
    await runRelayChatAgent('test-project', 'hello', []);
    const config = vi.mocked(runAgent).mock.calls[0][0];
    const canUseTool = config.canUseTool!;

    const outsideResult = await canUseTool('Read', { file_path: '/etc/passwd' });
    expect(outsideResult.behavior).toBe('deny');
  });

  it('tool callback allows paths inside project', async () => {
    await runRelayChatAgent('test-project', 'hello', []);
    const config = vi.mocked(runAgent).mock.calls[0][0];
    const canUseTool = config.canUseTool!;

    const insideResult = await canUseTool('Read', { file_path: join(projectDir, 'README.md') });
    expect(insideResult.behavior).toBe('allow');
  });

  it('returns error message on agent failure', async () => {
    vi.mocked(runAgent).mockResolvedValueOnce({
      success: false,
      result: 'Something went wrong',
      costUsd: 0,
      durationMs: 0,
      numTurns: 0,
    });
    const result = await runRelayChatAgent('test-project', 'hello', []);
    expect(result).toContain('error');
  });
});
