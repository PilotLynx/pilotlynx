import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import YAML from 'yaml';
import { removeGlobalConfig, resetGlobalConfigCache, getGlobalConfigPath } from '../../src/lib/global-config.js';

const CLI_PATH = join(process.cwd(), 'dist', 'cli.js');
const CONFIG_DIR_NAME = 'pilotlynx';

function runCli(args: string[], env?: Record<string, string>): { output: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    return { output: stdout, exitCode: 0 };
  } catch (err: any) {
    const combined = (err.stdout ?? '') + (err.stderr ?? '');
    return { output: combined || err.message, exitCode: err.status ?? 1 };
  }
}

describe('CLI integration', () => {
  let tmpDir: string;
  let configDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-cli-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);

    // Create a minimal workspace structure with new layout
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'plynx.yaml'), 'version: 1\nname: test\n');
    // Create empty project registry
    writeFileSync(join(configDir, 'projects.yaml'), YAML.stringify({ version: 1, projects: {} }));
    mkdirSync(join(configDir, 'template', 'workflows'), { recursive: true });
    mkdirSync(join(configDir, 'template', 'memory'), { recursive: true });
    mkdirSync(join(configDir, 'template', 'artifacts'), { recursive: true });
    mkdirSync(join(configDir, 'template', 'logs'), { recursive: true });
    mkdirSync(join(configDir, 'template', '.claude', 'skills'), { recursive: true });
    mkdirSync(join(configDir, 'shared', 'policies'), { recursive: true });
    mkdirSync(join(configDir, 'shared', 'docs'), { recursive: true });
    mkdirSync(join(configDir, 'shared', 'insights'), { recursive: true });
    writeFileSync(join(configDir, 'template', 'CLAUDE.md'), '# {{PROJECT_NAME}}\n');
    writeFileSync(join(configDir, 'template', 'PROJECT_BRIEF.md'), '# {{PROJECT_NAME}} Brief\n');
    writeFileSync(join(configDir, 'template', 'RUNBOOK.md'), '# {{PROJECT_NAME}} Runbook\n');
    writeFileSync(join(configDir, 'template', '.mcp.json'), '{ "mcpServers": {} }');
    writeFileSync(join(configDir, 'template', 'workflows', 'daily_feedback.ts'), 'export {}');
    writeFileSync(join(configDir, 'template', 'memory', '.gitkeep'), '');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const wsEnv = () => ({ PILOTLYNX_ROOT: configDir });

  it('--help shows usage', () => {
    const { output, exitCode } = runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(output).toContain('PilotLynx');
    expect(output).toContain('create');
    expect(output).toContain('add');
    expect(output).toContain('run');
    expect(output).toContain('verify');
    expect(output).toContain('improve');
    expect(output).toContain('init');
  });

  it('--version shows version', () => {
    const { output, exitCode } = runCli(['--version']);
    expect(exitCode).toBe(0);
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('list runs without error', () => {
    const { exitCode } = runCli(['list'], wsEnv());
    expect(exitCode).toBe(0);
  });

  it('verify nonexistent project fails', () => {
    const { exitCode, output } = runCli(['verify', 'nonexistent'], wsEnv());
    expect(exitCode).toBe(1);
    expect(output).toContain('does not exist');
  });

  it('unknown command shows suggestion', () => {
    const { output } = runCli(['creat']);
    expect(output).toContain('create');
  });

  it('init creates a workspace with pilotlynx/ dir and projects.yaml', () => {
    const initDir = mkdtempSync(join(tmpdir(), 'plynx-init-'));
    const { exitCode, output } = runCli(['init', '--name', 'myws', '--path', initDir]);
    expect(exitCode).toBe(0);
    expect(output).toContain('Workspace initialized');

    expect(existsSync(join(initDir, CONFIG_DIR_NAME, 'plynx.yaml'))).toBe(true);
    expect(existsSync(join(initDir, CONFIG_DIR_NAME, 'projects.yaml'))).toBe(true);
    expect(existsSync(join(initDir, CONFIG_DIR_NAME, 'template'))).toBe(true);
    expect(existsSync(join(initDir, CONFIG_DIR_NAME, 'shared', 'policies'))).toBe(true);

    // Verify projects.yaml is valid
    const registry = YAML.parse(readFileSync(join(initDir, CONFIG_DIR_NAME, 'projects.yaml'), 'utf8'));
    expect(registry.version).toBe(1);
    expect(registry.projects).toEqual({});

    rmSync(initDir, { recursive: true, force: true });
  });

  it('add --help shows usage', () => {
    const { output, exitCode } = runCli(['add', '--help']);
    expect(exitCode).toBe(0);
    expect(output).toContain('existing directory');
  });

  it('env --help shows usage', () => {
    const { output, exitCode } = runCli(['env', '--help']);
    expect(exitCode).toBe(0);
    expect(output).toContain('environment variables');
  });

  it('link --help shows usage', () => {
    const { output, exitCode } = runCli(['link', '--help']);
    expect(exitCode).toBe(0);
    expect(output).toContain('direct access');
  });

  it('unlink --help shows usage', () => {
    const { output, exitCode } = runCli(['unlink', '--help']);
    expect(exitCode).toBe(0);
    expect(output).toContain('direct-access');
  });

  it('init writes global config', () => {
    const initDir = mkdtempSync(join(tmpdir(), 'plynx-init-gc-'));
    const { exitCode } = runCli(['init', '--name', 'myws', '--path', initDir]);
    expect(exitCode).toBe(0);

    // Check global config was written
    resetGlobalConfigCache();
    const configPath = getGlobalConfigPath();
    expect(existsSync(configPath)).toBe(true);
    const content = YAML.parse(readFileSync(configPath, 'utf8'));
    expect(content.configRoot).toBe(join(initDir, CONFIG_DIR_NAME));

    // Clean up
    removeGlobalConfig();
    rmSync(initDir, { recursive: true, force: true });
  });
});
