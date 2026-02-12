import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import YAML from 'yaml';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../../src/lib/config.js';
import { resetRegistryCache, registerProject } from '../../../src/lib/registry.js';
import { resetPolicyCache } from '../../../src/lib/policy.js';
import { runDoctorChecks } from '../../../src/lib/command-ops/doctor-ops.js';

describe('doctor-ops', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  function setupFullWorkspace() {
    // Create workspace marker
    writeFileSync(
      join(configDir, 'plynx.yaml'),
      YAML.stringify({ version: 1, name: 'test-ws' })
    );

    // Create .env
    writeFileSync(join(configDir, '.env'), 'ANTHROPIC_API_KEY=sk-test\n');

    // Create policy files
    mkdirSync(join(configDir, 'shared', 'policies'), { recursive: true });
    writeFileSync(
      join(configDir, 'shared', 'policies', 'secrets-access.yaml'),
      YAML.stringify({ version: 1, shared: [], projects: {} })
    );
    writeFileSync(
      join(configDir, 'shared', 'policies', 'tool-access.yaml'),
      YAML.stringify({ version: 1, defaults: { allowed: ['Read'] }, projects: {} })
    );

    // Create template directory
    mkdirSync(join(configDir, 'template'), { recursive: true });
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-test-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    mkdirSync(configDir, { recursive: true });
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetRegistryCache();
    resetPolicyCache();
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
    resetPolicyCache();
  });

  it('reports pass for config root when it exists and is writable', () => {
    setupFullWorkspace();
    const checks = runDoctorChecks();
    const configRootCheck = checks.find(c => c.name === 'Config root');
    expect(configRootCheck?.status).toBe('pass');
  });

  it('reports pass for workspace marker when plynx.yaml exists', () => {
    setupFullWorkspace();
    const checks = runDoctorChecks();
    const markerCheck = checks.find(c => c.name === 'Workspace marker');
    expect(markerCheck?.status).toBe('pass');
  });

  it('reports fail for workspace marker when plynx.yaml is missing', () => {
    // No plynx.yaml
    const checks = runDoctorChecks();
    const markerCheck = checks.find(c => c.name === 'Workspace marker');
    expect(markerCheck?.status).toBe('fail');
  });

  it('reports warn for .env when not present', () => {
    writeFileSync(join(configDir, 'plynx.yaml'), YAML.stringify({ version: 1, name: 'x' }));
    const checks = runDoctorChecks();
    const envCheck = checks.find(c => c.name === '.env file');
    expect(envCheck?.status).toBe('warn');
  });

  it('reports pass for .env when present', () => {
    setupFullWorkspace();
    const checks = runDoctorChecks();
    const envCheck = checks.find(c => c.name === '.env file');
    expect(envCheck?.status).toBe('pass');
  });

  it('reports pass for valid project registry', () => {
    setupFullWorkspace();
    const projDir = join(tmpDir, 'myapp');
    mkdirSync(projDir, { recursive: true });
    registerProject('myapp', projDir);

    const checks = runDoctorChecks();
    const regCheck = checks.find(c => c.name === 'Project registry');
    expect(regCheck?.status).toBe('pass');
    expect(regCheck?.message).toContain('1 project(s)');
  });

  it('reports warn for missing project directories', () => {
    setupFullWorkspace();
    // Register a project that doesn't exist on disk
    const fakeDir = join(tmpDir, 'nonexistent');
    registerProject('ghost', fakeDir);

    const checks = runDoctorChecks();
    const regCheck = checks.find(c => c.name === 'Project registry');
    expect(regCheck?.status).toBe('warn');
    expect(regCheck?.message).toContain('ghost');
  });

  it('reports pass for valid secrets policy', () => {
    setupFullWorkspace();
    const checks = runDoctorChecks();
    const policyCheck = checks.find(c => c.name === 'Secrets policy');
    expect(policyCheck?.status).toBe('pass');
  });

  it('reports fail for invalid secrets policy', () => {
    setupFullWorkspace();
    writeFileSync(
      join(configDir, 'shared', 'policies', 'secrets-access.yaml'),
      'not: valid: yaml: [['
    );

    resetPolicyCache();
    const checks = runDoctorChecks();
    const policyCheck = checks.find(c => c.name === 'Secrets policy');
    expect(policyCheck?.status).toBe('fail');
  });

  it('reports pass for valid tool policy', () => {
    setupFullWorkspace();
    const checks = runDoctorChecks();
    const policyCheck = checks.find(c => c.name === 'Tool policy');
    expect(policyCheck?.status).toBe('pass');
  });

  it('reports warn for template directory not found', () => {
    writeFileSync(join(configDir, 'plynx.yaml'), YAML.stringify({ version: 1, name: 'x' }));
    const checks = runDoctorChecks();
    const templateCheck = checks.find(c => c.name === 'Template directory');
    expect(templateCheck?.status).toBe('warn');
  });

  it('reports pass for template directory when found', () => {
    setupFullWorkspace();
    const checks = runDoctorChecks();
    const templateCheck = checks.find(c => c.name === 'Template directory');
    expect(templateCheck?.status).toBe('pass');
  });

  it('returns 9 checks for a full workspace', () => {
    setupFullWorkspace();
    const checks = runDoctorChecks();
    expect(checks.length).toBe(9);
  });
});
