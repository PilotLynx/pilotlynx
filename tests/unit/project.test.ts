import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../src/lib/config.js';
import { resetRegistryCache, registerProject } from '../../src/lib/registry.js';
import { listProjects, projectExists, createProjectFromTemplate, verifyProject, addScaffolding } from '../../src/lib/project.js';

describe('project utilities', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-test-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetRegistryCache();

    // Create minimal structure: config dir with template
    mkdirSync(join(configDir, 'template', 'workflows'), { recursive: true });
    mkdirSync(join(configDir, 'template', 'memory'), { recursive: true });
    mkdirSync(join(configDir, 'template', 'artifacts'), { recursive: true });
    mkdirSync(join(configDir, 'template', 'logs'), { recursive: true });
    mkdirSync(join(configDir, 'template', '.claude', 'skills'), { recursive: true });
    writeFileSync(join(configDir, 'template', 'CLAUDE.md'), '# {{PROJECT_NAME}}\n');
    writeFileSync(join(configDir, 'template', 'PROJECT_BRIEF.md'), '# {{PROJECT_NAME}} Brief\n');
    writeFileSync(join(configDir, 'template', 'RUNBOOK.md'), '# {{PROJECT_NAME}} Runbook\n');
    writeFileSync(join(configDir, 'template', '.mcp.json'), '{ "mcpServers": {} }');
    writeFileSync(join(configDir, 'template', 'workflows', 'daily_feedback.ts'), 'export {}');
    writeFileSync(join(configDir, 'template', 'memory', '.gitkeep'), '');
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.PILOTLYNX_ROOT = origEnv;
    } else {
      delete process.env.PILOTLYNX_ROOT;
    }
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    resetRegistryCache();
  });

  describe('listProjects', () => {
    it('returns empty when no projects registered', () => {
      expect(listProjects()).toEqual([]);
    });

    it('lists registered projects', () => {
      mkdirSync(join(tmpDir, 'alpha'), { recursive: true });
      mkdirSync(join(tmpDir, 'beta'), { recursive: true });
      registerProject('alpha', join(tmpDir, 'alpha'));
      registerProject('beta', join(tmpDir, 'beta'));
      const projects = listProjects();
      expect(projects).toContain('alpha');
      expect(projects).toContain('beta');
    });
  });

  describe('projectExists', () => {
    it('returns false for unregistered project', () => {
      expect(projectExists('nope')).toBe(false);
    });

    it('returns false for registered project with missing directory', () => {
      // Register a path that doesn't exist on disk
      const ghostPath = join(tmpDir, 'ghost');
      writeFileSync(
        join(configDir, 'projects.yaml'),
        `version: 1\nprojects:\n  ghost:\n    path: ${ghostPath}\n`
      );
      resetRegistryCache();
      expect(projectExists('ghost')).toBe(false);
    });

    it('returns true for registered project with existing directory', () => {
      mkdirSync(join(tmpDir, 'exists'), { recursive: true });
      registerProject('exists', join(tmpDir, 'exists'));
      expect(projectExists('exists')).toBe(true);
    });
  });

  describe('createProjectFromTemplate', () => {
    const origCwd = process.cwd();
    beforeEach(() => process.chdir(tmpDir));
    afterEach(() => process.chdir(origCwd));

    it('creates project directory with template files and registers it', () => {
      createProjectFromTemplate('newproj');
      const projDir = join(tmpDir, 'newproj');
      expect(existsSync(projDir)).toBe(true);
      expect(existsSync(join(projDir, 'CLAUDE.md'))).toBe(true);
      expect(existsSync(join(projDir, 'PROJECT_BRIEF.md'))).toBe(true);
      expect(existsSync(join(projDir, 'workflows', 'daily_feedback.ts'))).toBe(true);
      // Verify registration
      expect(projectExists('newproj')).toBe(true);
    });

    it('replaces {{PROJECT_NAME}} placeholder', () => {
      createProjectFromTemplate('myapp');
      const content = readFileSync(join(tmpDir, 'myapp', 'CLAUDE.md'), 'utf8');
      expect(content).toContain('myapp');
      expect(content).not.toContain('{{PROJECT_NAME}}');
    });

    it('throws if project already exists', () => {
      mkdirSync(join(tmpDir, 'exists'), { recursive: true });
      expect(() => createProjectFromTemplate('exists')).toThrow('already exists');
    });

    it('rejects reserved pilotlynx name', () => {
      expect(() => createProjectFromTemplate(CONFIG_DIR_NAME)).toThrow('reserved');
    });
  });

  describe('addScaffolding', () => {
    it('creates missing files from template', () => {
      const projDir = join(tmpDir, 'existing');
      mkdirSync(projDir, { recursive: true });
      const { added } = addScaffolding('existing', projDir);
      expect(added).toContain('PROJECT_BRIEF.md');
      expect(added).toContain('CLAUDE.md');
      expect(added).toContain('RUNBOOK.md');
      expect(existsSync(join(projDir, 'PROJECT_BRIEF.md'))).toBe(true);
    });

    it('does not overwrite existing files', () => {
      const projDir = join(tmpDir, 'existing');
      mkdirSync(projDir, { recursive: true });
      writeFileSync(join(projDir, 'CLAUDE.md'), '# Existing content');
      const { skipped } = addScaffolding('existing', projDir);
      expect(skipped).toContain('CLAUDE.md');
      expect(readFileSync(join(projDir, 'CLAUDE.md'), 'utf8')).toBe('# Existing content');
    });

    it('creates missing directories', () => {
      const projDir = join(tmpDir, 'existing');
      mkdirSync(projDir, { recursive: true });
      const { added } = addScaffolding('existing', projDir);
      expect(added).toContain('workflows/');
      expect(added).toContain('memory/');
      expect(existsSync(join(projDir, 'workflows'))).toBe(true);
    });

    it('replaces {{PROJECT_NAME}} in new files only', () => {
      const projDir = join(tmpDir, 'existing');
      mkdirSync(projDir, { recursive: true });
      addScaffolding('myname', projDir);
      const content = readFileSync(join(projDir, 'PROJECT_BRIEF.md'), 'utf8');
      expect(content).toContain('myname');
      expect(content).not.toContain('{{PROJECT_NAME}}');
    });

    it('returns correct added and skipped lists', () => {
      const projDir = join(tmpDir, 'existing');
      mkdirSync(projDir, { recursive: true });
      mkdirSync(join(projDir, 'workflows'), { recursive: true });
      writeFileSync(join(projDir, 'CLAUDE.md'), '# Existing');
      const { added, skipped } = addScaffolding('existing', projDir);
      expect(skipped).toContain('CLAUDE.md');
      expect(added).not.toContain('CLAUDE.md');
      expect(added).toContain('PROJECT_BRIEF.md');
      expect(added).not.toContain('workflows/');
    });
  });

  describe('verifyProject', () => {
    it('validates a correct project', () => {
      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        createProjectFromTemplate('valid');
        const result = verifyProject('valid');
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      } finally {
        process.chdir(origCwd);
      }
    });

    it('detects missing required files', () => {
      mkdirSync(join(tmpDir, 'incomplete', 'workflows'), { recursive: true });
      mkdirSync(join(tmpDir, 'incomplete', 'memory'), { recursive: true });
      registerProject('incomplete', join(tmpDir, 'incomplete'));
      const result = verifyProject('incomplete');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('CLAUDE.md'))).toBe(true);
    });

    it('detects missing required directories', () => {
      mkdirSync(join(tmpDir, 'noworkflows'), { recursive: true });
      writeFileSync(join(tmpDir, 'noworkflows', 'CLAUDE.md'), '');
      writeFileSync(join(tmpDir, 'noworkflows', 'PROJECT_BRIEF.md'), '');
      writeFileSync(join(tmpDir, 'noworkflows', 'RUNBOOK.md'), '');
      registerProject('noworkflows', join(tmpDir, 'noworkflows'));
      const result = verifyProject('noworkflows');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('workflows'))).toBe(true);
    });
  });
});
