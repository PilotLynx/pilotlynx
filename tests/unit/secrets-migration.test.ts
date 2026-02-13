import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectProjectSecrets, buildMigrationPlan } from '../../src/lib/secrets-migration.js';

describe('detectProjectSecrets', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pilotlynx-secrets-migration-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty maps when no .env or .mcp.json exists', () => {
    const result = detectProjectSecrets(tmpDir);
    expect(result.envKeys.size).toBe(0);
    expect(result.mcpLiterals.size).toBe(0);
  });

  it('detects keys from .env', () => {
    writeFileSync(join(tmpDir, '.env'), 'API_KEY=test123\nDB_URL=postgres://localhost\n');
    const result = detectProjectSecrets(tmpDir);
    expect(result.envKeys.size).toBe(2);
    expect(result.envKeys.get('API_KEY')).toBe('test123');
    expect(result.envKeys.get('DB_URL')).toBe('postgres://localhost');
  });

  it('detects literal values in .mcp.json env blocks', () => {
    writeFileSync(join(tmpDir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        github: {
          command: 'npx',
          args: ['-y', '@mcp/server-github'],
          env: { GH_TOKEN: 'ghp_secret123' },
        },
      },
    }));
    const result = detectProjectSecrets(tmpDir);
    expect(result.mcpLiterals.size).toBe(1);
    expect(result.mcpLiterals.get('GH_TOKEN')).toBe('ghp_secret123');
  });

  it('skips ${VAR} references in .mcp.json', () => {
    writeFileSync(join(tmpDir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        github: {
          command: 'npx',
          env: {
            GH_TOKEN: '${GITHUB_TOKEN}',
            LITERAL_KEY: 'actual_value',
          },
        },
      },
    }));
    const result = detectProjectSecrets(tmpDir);
    expect(result.mcpLiterals.size).toBe(1);
    expect(result.mcpLiterals.has('GH_TOKEN')).toBe(false);
    expect(result.mcpLiterals.get('LITERAL_KEY')).toBe('actual_value');
  });

  it('handles invalid .mcp.json gracefully', () => {
    writeFileSync(join(tmpDir, '.mcp.json'), 'not valid json');
    const result = detectProjectSecrets(tmpDir);
    expect(result.mcpLiterals.size).toBe(0);
  });

  it('handles .mcp.json with no mcpServers key', () => {
    writeFileSync(join(tmpDir, '.mcp.json'), JSON.stringify({ other: 'config' }));
    const result = detectProjectSecrets(tmpDir);
    expect(result.mcpLiterals.size).toBe(0);
  });

  it('detects literals from multiple servers', () => {
    writeFileSync(join(tmpDir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        github: { command: 'npx', env: { GH_TOKEN: 'ghp_abc' } },
        slack: { command: 'npx', env: { SLACK_KEY: 'xoxb-123' } },
      },
    }));
    const result = detectProjectSecrets(tmpDir);
    expect(result.mcpLiterals.size).toBe(2);
    expect(result.mcpLiterals.get('GH_TOKEN')).toBe('ghp_abc');
    expect(result.mcpLiterals.get('SLACK_KEY')).toBe('xoxb-123');
  });
});

describe('buildMigrationPlan', () => {
  let tmpDir: string;
  let projectDir: string;
  let centralEnvPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pilotlynx-migration-plan-'));
    projectDir = join(tmpDir, 'myproject');
    mkdirSync(projectDir, { recursive: true });
    centralEnvPath = join(tmpDir, 'central.env');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty plan for project with no secrets', () => {
    writeFileSync(centralEnvPath, '');
    const plan = buildMigrationPlan(projectDir, centralEnvPath);
    expect(plan.isEmpty).toBe(true);
    expect(plan.keys).toEqual([]);
    expect(plan.envAppendLines).toEqual([]);
    expect(plan.rewrittenMcpJson).toBeNull();
    expect(plan.policyKeys).toEqual([]);
    expect(plan.detectedValues).toEqual({});
  });

  it('categorizes new keys from .env', () => {
    writeFileSync(join(projectDir, '.env'), 'NEW_KEY=new_value\n');
    writeFileSync(centralEnvPath, '');
    const plan = buildMigrationPlan(projectDir, centralEnvPath);
    expect(plan.isEmpty).toBe(false);
    expect(plan.keys).toEqual([
      { key: 'NEW_KEY', category: 'new', source: '.env' },
    ]);
    expect(plan.envAppendLines).toEqual(['NEW_KEY=new_value']);
    expect(plan.policyKeys).toEqual(['NEW_KEY']);
    expect(plan.detectedValues).toEqual({ NEW_KEY: 'new_value' });
  });

  it('deduplicates keys with same value in central .env', () => {
    writeFileSync(join(projectDir, '.env'), 'API_KEY=same_value\n');
    writeFileSync(centralEnvPath, 'API_KEY=same_value\n');
    const plan = buildMigrationPlan(projectDir, centralEnvPath);
    expect(plan.keys).toEqual([
      { key: 'API_KEY', category: 'deduplicated', source: '.env' },
    ]);
    expect(plan.envAppendLines).toEqual([]);
    expect(plan.policyKeys).toEqual(['API_KEY']);
  });

  it('detects conflicting keys with different values', () => {
    writeFileSync(join(projectDir, '.env'), 'API_KEY=project_value\n');
    writeFileSync(centralEnvPath, 'API_KEY=central_value\n');
    const plan = buildMigrationPlan(projectDir, centralEnvPath);
    expect(plan.keys).toEqual([
      { key: 'API_KEY', category: 'conflicting', source: '.env' },
    ]);
    expect(plan.envAppendLines).toEqual([]);
    expect(plan.policyKeys).toEqual([]);
  });

  it('handles mix of new, deduplicated, and conflicting keys', () => {
    writeFileSync(join(projectDir, '.env'), [
      'NEW_KEY=new_val',
      'SAME_KEY=same_val',
      'CONFLICT_KEY=project_val',
    ].join('\n') + '\n');
    writeFileSync(centralEnvPath, [
      'SAME_KEY=same_val',
      'CONFLICT_KEY=central_val',
    ].join('\n') + '\n');

    const plan = buildMigrationPlan(projectDir, centralEnvPath);
    const byKey = Object.fromEntries(plan.keys.map(k => [k.key, k]));
    expect(byKey['NEW_KEY'].category).toBe('new');
    expect(byKey['SAME_KEY'].category).toBe('deduplicated');
    expect(byKey['CONFLICT_KEY'].category).toBe('conflicting');
    expect(plan.envAppendLines).toEqual(['NEW_KEY=new_val']);
    expect(plan.policyKeys).toContain('NEW_KEY');
    expect(plan.policyKeys).toContain('SAME_KEY');
    expect(plan.policyKeys).not.toContain('CONFLICT_KEY');
    expect(plan.detectedValues).toEqual({
      NEW_KEY: 'new_val',
      SAME_KEY: 'same_val',
      CONFLICT_KEY: 'project_val',
    });
  });

  it('deduplicates keys appearing in both .env and .mcp.json', () => {
    writeFileSync(join(projectDir, '.env'), 'TOKEN=abc123\n');
    writeFileSync(join(projectDir, '.mcp.json'), JSON.stringify({
      mcpServers: { s: { command: 'x', env: { TOKEN: 'abc123' } } },
    }));
    writeFileSync(centralEnvPath, '');

    const plan = buildMigrationPlan(projectDir, centralEnvPath);
    // .env takes precedence, key should appear once
    const tokenKeys = plan.keys.filter(k => k.key === 'TOKEN');
    expect(tokenKeys).toHaveLength(1);
    expect(tokenKeys[0].source).toBe('.env');
    expect(plan.envAppendLines).toEqual(['TOKEN=abc123']);
  });

  it('rewrites .mcp.json literals to ${VAR} references', () => {
    writeFileSync(join(projectDir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        github: {
          command: 'npx',
          env: { GH_TOKEN: 'ghp_secret', EXISTING_REF: '${SOME_VAR}' },
        },
      },
    }));
    writeFileSync(centralEnvPath, '');

    const plan = buildMigrationPlan(projectDir, centralEnvPath);
    expect(plan.rewrittenMcpJson).not.toBeNull();
    const rewritten = JSON.parse(plan.rewrittenMcpJson!);
    expect(rewritten.mcpServers.github.env.GH_TOKEN).toBe('${GH_TOKEN}');
    expect(rewritten.mcpServers.github.env.EXISTING_REF).toBe('${SOME_VAR}');
  });

  it('does not rewrite conflicting keys in .mcp.json', () => {
    writeFileSync(join(projectDir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        s: { command: 'x', env: { KEY: 'project_val' } },
      },
    }));
    writeFileSync(centralEnvPath, 'KEY=central_val\n');

    const plan = buildMigrationPlan(projectDir, centralEnvPath);
    const rewritten = JSON.parse(plan.rewrittenMcpJson!);
    // Conflicting key should NOT be rewritten to ${VAR}
    expect(rewritten.mcpServers.s.env.KEY).toBe('project_val');
  });

  it('returns null rewrittenMcpJson when no .mcp.json exists', () => {
    writeFileSync(join(projectDir, '.env'), 'KEY=val\n');
    writeFileSync(centralEnvPath, '');
    const plan = buildMigrationPlan(projectDir, centralEnvPath);
    expect(plan.rewrittenMcpJson).toBeNull();
  });

  it('handles central .env that does not exist', () => {
    writeFileSync(join(projectDir, '.env'), 'KEY=val\n');
    const plan = buildMigrationPlan(projectDir, join(tmpDir, 'nonexistent.env'));
    expect(plan.keys).toEqual([
      { key: 'KEY', category: 'new', source: '.env' },
    ]);
  });
});
