import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../src/lib/config.js';
import { resetPolicyCache } from '../../src/lib/policy.js';
import { buildProjectTools } from '../../src/lib/tools.js';
import { pathEnforcementCallback } from '../../src/lib/callbacks.js';

describe('tools', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pilotlynx-test-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetPolicyCache();

    mkdirSync(join(configDir, 'shared', 'policies'), { recursive: true });
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.PILOTLYNX_ROOT = origEnv;
    } else {
      delete process.env.PILOTLYNX_ROOT;
    }
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    resetPolicyCache();
  });

  describe('buildProjectTools', () => {
    it('returns conservative defaults when no policy file exists', () => {
      const result = buildProjectTools('myproject');
      expect(result.allowedTools).toEqual(['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash']);
      expect(result.disallowedTools).toEqual([]);
    });

    it('returns defaults when project has no overrides', () => {
      writeFileSync(
        join(configDir, 'shared', 'policies', 'tool-access.yaml'),
        `version: 1
defaults:
  allowed:
    - Read
    - Write
    - Glob
projects: {}
`
      );
      const result = buildProjectTools('myproject');
      expect(result.allowedTools).toEqual(['Read', 'Write', 'Glob']);
      expect(result.disallowedTools).toEqual([]);
    });

    it('uses project-specific allowed list when specified', () => {
      writeFileSync(
        join(configDir, 'shared', 'policies', 'tool-access.yaml'),
        `version: 1
defaults:
  allowed:
    - Read
    - Write
    - Glob
    - Bash
projects:
  restricted:
    allowed:
      - Read
      - Glob
`
      );
      const result = buildProjectTools('restricted');
      expect(result.allowedTools).toEqual(['Read', 'Glob']);
    });

    it('applies project-level disallowed on top of defaults', () => {
      writeFileSync(
        join(configDir, 'shared', 'policies', 'tool-access.yaml'),
        `version: 1
defaults:
  allowed:
    - Read
    - Write
    - Bash
projects:
  nobash:
    disallowed:
      - Bash
`
      );
      const result = buildProjectTools('nobash');
      expect(result.allowedTools).toEqual(['Read', 'Write', 'Bash']);
      expect(result.disallowedTools).toEqual(['Bash']);
    });
  });

  describe('pathEnforcementCallback', () => {
    it('allows Write within project directory', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Write', { file_path: join(projectDir, 'file.txt') });
      expect(result.behavior).toBe('allow');
    });

    it('denies Write outside project directory', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Write', { file_path: '/tmp/evil.txt' });
      expect(result.behavior).toBe('deny');
    });

    it('denies Edit outside project directory', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Edit', { file_path: join(tmpDir, 'other', 'file.txt') });
      expect(result.behavior).toBe('deny');
    });

    it('allows Bash commands within project', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Bash', { command: 'ls workflows/' });
      expect(result.behavior).toBe('allow');
    });

    it('denies Bash cd to outside project', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Bash', { command: 'cd /tmp && rm -rf /' });
      expect(result.behavior).toBe('deny');
    });

    it('denies Bash with absolute paths outside project', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Bash', { command: 'cat /etc/passwd' });
      expect(result.behavior).toBe('deny');
    });

    it('allows Bash with absolute paths inside project', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Bash', { command: `cat ${projectDir}/file.txt` });
      expect(result.behavior).toBe('allow');
    });

    it('denies Bash cd with relative path escaping project', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Bash', { command: 'cd ../../shared && cat secrets.yaml' });
      expect(result.behavior).toBe('deny');
    });

    it('denies Read tool outside project directory', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Read', { file_path: '/any/path' });
      expect(result.behavior).toBe('deny');
    });

    it('allows Read tool within project directory', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Read', { file_path: join(projectDir, 'file.txt') });
      expect(result.behavior).toBe('allow');
    });

    it('allows Read in additional directories', async () => {
      const projectDir = join(tmpDir, 'test');
      const sharedDir = join(tmpDir, 'shared-docs');
      mkdirSync(projectDir, { recursive: true });
      mkdirSync(sharedDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir, [sharedDir]);
      const result = await callback('Read', { file_path: join(sharedDir, 'doc.md') });
      expect(result.behavior).toBe('allow');
    });

    // --- Bash sandbox bypass tests ---

    it('denies Bash command substitution $(...)', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Bash', { command: 'cat $(echo /etc/passwd)' });
      expect(result.behavior).toBe('deny');
    });

    it('denies Bash backtick substitution', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Bash', { command: 'cat `echo /etc/passwd`' });
      expect(result.behavior).toBe('deny');
    });

    it('denies Bash variable expansion $VAR', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Bash', { command: 'cat $HOME/.ssh/id_rsa' });
      expect(result.behavior).toBe('deny');
    });

    it('denies Bash variable expansion ${VAR}', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Bash', { command: 'cat ${HOME}/.ssh/id_rsa' });
      expect(result.behavior).toBe('deny');
    });

    it('denies Bash relative path traversal without cd', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Bash', { command: 'cat ../../pilotlynx/.env' });
      expect(result.behavior).toBe('deny');
    });

    it('denies Bash relative path traversal in piped commands', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Bash', { command: 'echo harmless ; cat ../../.env' });
      expect(result.behavior).toBe('deny');
    });

    it('denies Bash process substitution <(...)', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Bash', { command: 'diff <(cat /etc/passwd) file.txt' });
      expect(result.behavior).toBe('deny');
    });

    it('denies Bash shell inception (bash -c)', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Bash', { command: 'bash -c "cat /etc/passwd"' });
      expect(result.behavior).toBe('deny');
    });

    it('denies Bash eval', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Bash', { command: 'eval "cat /etc/passwd"' });
      expect(result.behavior).toBe('deny');
    });

    it('denies Bash symlink creation (ln -s)', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Bash', { command: 'ln -s /etc/passwd ./link.txt' });
      expect(result.behavior).toBe('deny');
    });

    it('denies Bash pushd to outside project', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Bash', { command: 'pushd /tmp && cat secret.txt' });
      expect(result.behavior).toBe('deny');
    });

    // --- Path prefix collision tests ---

    it('denies Write to sibling directory with similar prefix', async () => {
      const projectDir = join(tmpDir, 'project');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Write', { file_path: join(tmpDir, 'project-evil', 'hack.txt') });
      expect(result.behavior).toBe('deny');
    });

    // --- Glob/Grep enforcement tests ---

    it('denies Glob outside project directory', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Glob', { path: '/home/user/' });
      expect(result.behavior).toBe('deny');
    });

    it('allows Glob within project directory', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Glob', { path: join(projectDir, 'src') });
      expect(result.behavior).toBe('allow');
    });

    it('denies Grep outside project directory', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Grep', { path: '/etc/' });
      expect(result.behavior).toBe('deny');
    });

    it('allows Grep within project directory', async () => {
      const projectDir = join(tmpDir, 'test');
      mkdirSync(projectDir, { recursive: true });
      const callback = pathEnforcementCallback(projectDir);
      const result = await callback('Grep', { path: join(projectDir, 'src') });
      expect(result.behavior).toBe('allow');
    });
  });
});
