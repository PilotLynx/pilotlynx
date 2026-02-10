import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPrompt, loadSystemPrompt, resetPromptCache } from '../../src/lib/prompts.js';

describe('prompt loader', () => {
  beforeEach(() => {
    resetPromptCache();
  });

  afterEach(() => {
    resetPromptCache();
  });

  describe('loadPrompt', () => {
    it('interpolates {{variables}} correctly', () => {
      const result = loadPrompt('run', 'run_default', { workflow: 'deploy' });
      expect(result).toContain('Execute the workflow "deploy"');
    });

    it('interpolates multiple variables', () => {
      const result = loadPrompt('run', 'run_with_feedback', {
        workflow: 'test',
        feedback: 'Please retry with verbose logging.',
      });
      expect(result).toContain('"test"');
      expect(result).toContain('Please retry with verbose logging.');
    });

    it('throws on missing variable', () => {
      expect(() => loadPrompt('run', 'run_with_feedback', { workflow: 'test' }))
        .toThrow('Missing prompt variable: {{feedback}}');
    });

    it('throws on missing prompt key', () => {
      expect(() => loadPrompt('run', 'nonexistent_prompt'))
        .toThrow('Prompt "nonexistent_prompt" not found in run.yaml');
    });

    it('throws on missing agent YAML file', () => {
      expect(() => loadPrompt('nonexistent-agent', 'some_prompt'))
        .toThrow();
    });
  });

  describe('loadSystemPrompt', () => {
    it('loads system prompt from improve.yaml', () => {
      const result = loadSystemPrompt('improve', 'improve_analyze');
      expect(result).toBeDefined();
      expect(result).toContain('code quality and process improvement analyst');
    });

    it('returns undefined when systemPrompts section is absent', () => {
      const result = loadSystemPrompt('run', 'run_default');
      expect(result).toBeUndefined();
    });

    it('returns undefined for missing key in existing systemPrompts', () => {
      const result = loadSystemPrompt('improve', 'nonexistent_key');
      expect(result).toBeUndefined();
    });
  });

  describe('real YAML file validation', () => {
    it('loads run.yaml — run_default', () => {
      const result = loadPrompt('run', 'run_default', { workflow: 'build' });
      expect(result).toContain('Execute the workflow "build"');
      expect(result).toContain('operational rules');
    });

    it('loads run.yaml — run_with_feedback', () => {
      const result = loadPrompt('run', 'run_with_feedback', {
        workflow: 'deploy',
        feedback: 'Use staging env.',
      });
      expect(result).toContain('"deploy"');
      expect(result).toContain('Use staging env.');
    });

    it('loads project-create.yaml — project_create', () => {
      const result = loadPrompt('project-create', 'project_create', {
        name: 'my-app',
        projectDir: '/workspace/projects/my-app',
        availableSecretKeys: 'ANTHROPIC_API_KEY, GITHUB_TOKEN',
        currentSecretsPolicy: 'version: 1\nshared: []\nprojects: {}\n',
        secretsPolicyPath: '/workspace/pilotlynx/shared/policies/secrets-access.yaml',
      });
      expect(result).toContain('"my-app"');
      expect(result).toContain('/workspace/projects/my-app');
      expect(result).toContain('PROJECT_BRIEF.md');
      expect(result).toContain('ANTHROPIC_API_KEY');
    });

    it('loads project-add.yaml — project_add', () => {
      const result = loadPrompt('project-add', 'project_add', {
        name: 'existing-repo',
        projectDir: '/home/user/repos/existing-repo',
        availableSecretKeys: 'ANTHROPIC_API_KEY',
        currentSecretsPolicy: 'version: 1\nshared: []\nprojects: {}\n',
        secretsPolicyPath: '/workspace/pilotlynx/shared/policies/secrets-access.yaml',
      });
      expect(result).toContain('"existing-repo"');
      expect(result).toContain('/home/user/repos/existing-repo');
      expect(result).toContain('existing code');
    });

    it('loads improve.yaml — improve_analyze', () => {
      const result = loadPrompt('improve', 'improve_analyze', {
        summaryText: '## alpha\nAll tests passed.',
      });
      expect(result).toContain('## alpha');
      expect(result).toContain('structured feedback');
    });

    it('loads sync-template.yaml — sync_template', () => {
      const result = loadPrompt('sync-template', 'sync_template', {
        project: 'beta',
        templateDir: '/pkg/template',
        projectDir: '/workspace/projects/beta',
      });
      expect(result).toContain('"beta"');
      expect(result).toContain('/pkg/template');
      expect(result).toContain('/workspace/projects/beta');
    });
  });

  describe('caching', () => {
    it('caches loaded prompt files', () => {
      const first = loadPrompt('run', 'run_default', { workflow: 'a' });
      const second = loadPrompt('run', 'run_default', { workflow: 'b' });
      // Both should work — cache stores the file, not interpolated results
      expect(first).toContain('"a"');
      expect(second).toContain('"b"');
    });

    it('resetPromptCache clears the cache', () => {
      loadPrompt('run', 'run_default', { workflow: 'x' });
      resetPromptCache();
      // Should still work after cache reset (reloads from disk)
      const result = loadPrompt('run', 'run_default', { workflow: 'y' });
      expect(result).toContain('"y"');
    });
  });
});
