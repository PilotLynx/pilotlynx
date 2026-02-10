import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildRuntimeEnv, SYSTEM_ENV_PASSTHROUGH } from '../../src/lib/agent-runner.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

describe('buildRuntimeEnv', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of SYSTEM_ENV_PASSTHROUGH) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of SYSTEM_ENV_PASSTHROUGH) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('includes system vars present in process.env', () => {
    process.env.HOME = '/home/testuser';
    process.env.PATH = '/usr/bin';

    const result = buildRuntimeEnv({});
    expect(result.HOME).toBe('/home/testuser');
    expect(result.PATH).toBe('/usr/bin');
  });

  it('omits system vars not present in process.env', () => {
    delete process.env.CLAUDE_CONFIG_DIR;

    const result = buildRuntimeEnv({});
    expect(result).not.toHaveProperty('CLAUDE_CONFIG_DIR');
  });

  it('includes policy secrets in the output', () => {
    const result = buildRuntimeEnv({ ANTHROPIC_API_KEY: 'sk-123', GITHUB_TOKEN: 'ghp_abc' });
    expect(result.ANTHROPIC_API_KEY).toBe('sk-123');
    expect(result.GITHUB_TOKEN).toBe('ghp_abc');
  });

  it('policy secrets override system vars on collision', () => {
    process.env.HOME = '/home/testuser';

    const result = buildRuntimeEnv({ HOME: '/overridden' });
    expect(result.HOME).toBe('/overridden');
  });

  it('does not leak non-passthrough system vars', () => {
    process.env.SECRET_SYSTEM_VAR = 'should-not-appear';

    const result = buildRuntimeEnv({});
    expect(result).not.toHaveProperty('SECRET_SYSTEM_VAR');

    delete process.env.SECRET_SYSTEM_VAR;
  });

  it('returns only policy secrets when no system vars are set', () => {
    for (const key of SYSTEM_ENV_PASSTHROUGH) {
      delete process.env[key];
    }

    const policy = { ANTHROPIC_API_KEY: 'sk-123' };
    const result = buildRuntimeEnv(policy);
    expect(result).toEqual(policy);
  });
});

describe('runAgent', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const sdkModule = await import('@anthropic-ai/claude-agent-sdk');
    mockQuery = sdkModule.query as ReturnType<typeof vi.fn>;
    mockQuery.mockReset();
  });

  async function importRunAgent() {
    const mod = await import('../../src/lib/agent-runner.js');
    return mod.runAgent;
  }

  function createAsyncGenerator(messages: unknown[]) {
    return async function* () {
      for (const msg of messages) {
        yield msg;
      }
    };
  }

  it('returns success with text content (string)', async () => {
    const runAgent = await importRunAgent();
    mockQuery.mockReturnValue(createAsyncGenerator([
      { type: 'assistant', content: 'Hello from agent' },
      { type: 'result', subtype: 'success', result: 'Task complete', total_cost_usd: 0.05, num_turns: 3 },
    ])());

    const result = await runAgent({ prompt: 'test' });

    expect(result.success).toBe(true);
    expect(result.result).toBe('Task complete');
    expect(result.costUsd).toBe(0.05);
    expect(result.numTurns).toBe(3);
  });

  it('returns success with content blocks array', async () => {
    const runAgent = await importRunAgent();
    mockQuery.mockReturnValue(createAsyncGenerator([
      {
        type: 'assistant',
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: ' Part 2' },
        ],
      },
      { type: 'result', subtype: 'success', result: 'Done', total_cost_usd: 0.01, num_turns: 1 },
    ])());

    const result = await runAgent({ prompt: 'test' });

    expect(result.success).toBe(true);
    expect(result.result).toBe('Done');
  });

  it('returns success with structured output', async () => {
    const runAgent = await importRunAgent();
    const structuredData = { feedback: 'good', score: 9 };
    mockQuery.mockReturnValue(createAsyncGenerator([
      { type: 'result', subtype: 'success', result: 'ok', structured_output: structuredData, total_cost_usd: 0.02, num_turns: 2 },
    ])());

    const result = await runAgent({ prompt: 'test' });

    expect(result.success).toBe(true);
    expect(result.structuredOutput).toEqual(structuredData);
  });

  it('returns error result from SDK', async () => {
    const runAgent = await importRunAgent();
    mockQuery.mockReturnValue(createAsyncGenerator([
      { type: 'result', subtype: 'error', error: 'Something went wrong', total_cost_usd: 0.001, num_turns: 1 },
    ])());

    const result = await runAgent({ prompt: 'test' });

    expect(result.success).toBe(false);
    expect(result.result).toBe('Something went wrong');
  });

  it('handles SDK exception gracefully', async () => {
    const runAgent = await importRunAgent();
    mockQuery.mockImplementation(() => {
      throw new Error('SDK connection failed');
    });

    const result = await runAgent({ prompt: 'test' });

    expect(result.success).toBe(false);
    expect(result.result).toBe('SDK connection failed');
  });

  it('tracks duration', async () => {
    const runAgent = await importRunAgent();
    mockQuery.mockReturnValue(createAsyncGenerator([
      { type: 'result', subtype: 'success', result: 'ok', total_cost_usd: 0, num_turns: 1 },
    ])());

    const result = await runAgent({ prompt: 'test' });

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
