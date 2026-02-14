import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { projectSetupCallback, feedbackPathEnforcementCallback, containsPotentialSecrets } from '../../src/lib/callbacks.js';

describe('projectSetupCallback', () => {
  let tmpDir: string;
  let projectDir: string;
  let policiesDir: string;

  function setup() {
    tmpDir = mkdtempSync(join(tmpdir(), 'pilotlynx-cb-'));
    projectDir = join(tmpDir, 'myproject');
    policiesDir = join(tmpDir, 'pilotlynx', 'shared', 'policies');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(policiesDir, { recursive: true });
  }

  describe('Write/Edit enforcement', () => {
    it('allows Write inside projectDir', async () => {
      setup();
      const callback = projectSetupCallback(projectDir, policiesDir);
      const result = await callback('Write', { file_path: join(projectDir, 'file.txt') });
      expect(result.behavior).toBe('allow');
    });

    it('allows Write inside policiesDir', async () => {
      setup();
      const callback = projectSetupCallback(projectDir, policiesDir);
      const result = await callback('Write', { file_path: join(policiesDir, 'secrets-access.yaml') });
      expect(result.behavior).toBe('allow');
    });

    it('denies Write outside both directories', async () => {
      setup();
      const callback = projectSetupCallback(projectDir, policiesDir);
      const result = await callback('Write', { file_path: '/tmp/evil.txt' });
      expect(result.behavior).toBe('deny');
    });

    it('allows Edit inside projectDir', async () => {
      setup();
      const callback = projectSetupCallback(projectDir, policiesDir);
      const result = await callback('Edit', { file_path: join(projectDir, 'CLAUDE.md') });
      expect(result.behavior).toBe('allow');
    });

    it('denies Edit outside both directories', async () => {
      setup();
      const callback = projectSetupCallback(projectDir, policiesDir);
      const result = await callback('Edit', { file_path: join(tmpDir, 'other', 'file.txt') });
      expect(result.behavior).toBe('deny');
    });
  });

  describe('Bash enforcement (new)', () => {
    it('denies Bash with absolute paths outside project', async () => {
      setup();
      const callback = projectSetupCallback(projectDir, policiesDir);
      const result = await callback('Bash', { command: 'cat /etc/passwd' });
      expect(result.behavior).toBe('deny');
    });

    it('denies Bash with path traversal', async () => {
      setup();
      const callback = projectSetupCallback(projectDir, policiesDir);
      const result = await callback('Bash', { command: 'cat ../../.env' });
      expect(result.behavior).toBe('deny');
    });

    it('denies Bash with tilde expansion', async () => {
      setup();
      const callback = projectSetupCallback(projectDir, policiesDir);
      const result = await callback('Bash', { command: 'cat ~/.ssh/id_rsa' });
      expect(result.behavior).toBe('deny');
    });

    it('denies Bash with brace expansion', async () => {
      setup();
      const callback = projectSetupCallback(projectDir, policiesDir);
      const result = await callback('Bash', { command: 'cat /etc/{passwd,shadow}' });
      expect(result.behavior).toBe('deny');
    });

    it('denies Bash with encoded characters', async () => {
      setup();
      const callback = projectSetupCallback(projectDir, policiesDir);
      const result = await callback('Bash', { command: 'printf "\\x2f\\x65\\x74\\x63"' });
      expect(result.behavior).toBe('deny');
    });

    it('allows Bash for safe relative commands', async () => {
      setup();
      const callback = projectSetupCallback(projectDir, policiesDir);
      const result = await callback('Bash', { command: 'npm test' });
      expect(result.behavior).toBe('allow');
    });

    it('allows Bash with relative paths inside project', async () => {
      setup();
      const callback = projectSetupCallback(projectDir, policiesDir);
      const result = await callback('Bash', { command: 'ls workflows/' });
      expect(result.behavior).toBe('allow');
    });
  });

  describe('other tools pass through', () => {
    it('allows Read tool (not restricted by projectSetupCallback)', async () => {
      setup();
      const callback = projectSetupCallback(projectDir, policiesDir);
      const result = await callback('Read', { file_path: '/any/path' });
      expect(result.behavior).toBe('allow');
    });

    it('allows Glob tool', async () => {
      setup();
      const callback = projectSetupCallback(projectDir, policiesDir);
      const result = await callback('Glob', { path: '/any/path' });
      expect(result.behavior).toBe('allow');
    });
  });
});

describe('containsPotentialSecrets', () => {
  it('returns generic message without partial secret text', () => {
    const secret = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
    const result = containsPotentialSecrets(`token=${secret}`);
    expect(result).not.toBeNull();
    expect(result).toBe('Potential secret pattern detected in output.');
    // Must NOT contain any part of the actual secret
    expect(result).not.toContain('ghp_');
    expect(result).not.toContain('ABCDEFGH');
  });

  it('detects JWT tokens without leaking them', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.signature';
    const result = containsPotentialSecrets(jwt);
    expect(result).toBe('Potential secret pattern detected in output.');
    expect(result).not.toContain('eyJ');
  });

  it('returns null for safe content', () => {
    expect(containsPotentialSecrets('just normal text')).toBeNull();
  });
});

describe('feedbackPathEnforcementCallback', () => {
  let tmpDir: string;
  let projectDir: string;

  function setup() {
    tmpDir = mkdtempSync(join(tmpdir(), 'pilotlynx-feedback-cb-'));
    projectDir = join(tmpDir, 'myproject');
    mkdirSync(join(projectDir, '.claude'), { recursive: true });
  }

  describe('denied files', () => {
    it('denies Write to .mcp.json', async () => {
      setup();
      const callback = feedbackPathEnforcementCallback(projectDir);
      const result = await callback('Write', { file_path: join(projectDir, '.mcp.json') });
      expect(result.behavior).toBe('deny');
      if (result.behavior === 'deny') {
        expect(result.message).toContain('.mcp.json');
      }
    });

    it('denies Edit to .claude/settings.json', async () => {
      setup();
      const callback = feedbackPathEnforcementCallback(projectDir);
      const result = await callback('Edit', { file_path: join(projectDir, '.claude/settings.json') });
      expect(result.behavior).toBe('deny');
      if (result.behavior === 'deny') {
        expect(result.message).toContain('settings.json');
      }
    });

    it('denies Write to .claude/settings.local.json', async () => {
      setup();
      const callback = feedbackPathEnforcementCallback(projectDir);
      const result = await callback('Write', { file_path: join(projectDir, '.claude/settings.local.json') });
      expect(result.behavior).toBe('deny');
    });
  });

  describe('allowed files', () => {
    it('allows Write to memory files', async () => {
      setup();
      const callback = feedbackPathEnforcementCallback(projectDir);
      const result = await callback('Write', { file_path: join(projectDir, 'memory/MEMORY.md') });
      expect(result.behavior).toBe('allow');
    });

    it('allows Write to .claude/skills/', async () => {
      setup();
      const callback = feedbackPathEnforcementCallback(projectDir);
      const result = await callback('Write', { file_path: join(projectDir, '.claude/skills/new-skill.md') });
      expect(result.behavior).toBe('allow');
    });

    it('allows Write to .claude/rules/', async () => {
      setup();
      const callback = feedbackPathEnforcementCallback(projectDir);
      const result = await callback('Write', { file_path: join(projectDir, '.claude/rules/new-rule.md') });
      expect(result.behavior).toBe('allow');
    });

    it('allows Read of .mcp.json (reading is fine)', async () => {
      setup();
      const callback = feedbackPathEnforcementCallback(projectDir);
      const result = await callback('Read', { file_path: join(projectDir, '.mcp.json') });
      expect(result.behavior).toBe('allow');
    });

    it('allows Read of .claude/settings.json', async () => {
      setup();
      const callback = feedbackPathEnforcementCallback(projectDir);
      const result = await callback('Read', { file_path: join(projectDir, '.claude/settings.json') });
      expect(result.behavior).toBe('allow');
    });
  });

  describe('path enforcement', () => {
    it('denies Write outside project directory', async () => {
      setup();
      const callback = feedbackPathEnforcementCallback(projectDir);
      const result = await callback('Write', { file_path: '/tmp/evil.txt' });
      expect(result.behavior).toBe('deny');
    });

    it('denies Read outside project directory', async () => {
      setup();
      const callback = feedbackPathEnforcementCallback(projectDir);
      const result = await callback('Read', { file_path: '/etc/passwd' });
      expect(result.behavior).toBe('deny');
    });

    it('allows access to additional directories', async () => {
      setup();
      const sharedDir = join(tmpDir, 'shared');
      mkdirSync(sharedDir, { recursive: true });
      const callback = feedbackPathEnforcementCallback(projectDir, [sharedDir]);
      const result = await callback('Read', { file_path: join(sharedDir, 'docs/patterns/retry.md') });
      expect(result.behavior).toBe('allow');
    });
  });
});
