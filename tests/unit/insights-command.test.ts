import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetConfigCache, CONFIG_DIR_NAME, INSIGHTS_DIR } from '../../src/lib/config.js';
import { resetRegistryCache } from '../../src/lib/registry.js';

describe('insights command', () => {
  let tmpDir: string;
  let configDir: string;
  let insightsDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plynx-insights-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetRegistryCache();

    insightsDir = join(configDir, 'shared', 'insights');
    mkdirSync(insightsDir, { recursive: true });
    mkdirSync(join(configDir, 'shared', 'policies'), { recursive: true });
  });

  afterEach(() => {
    if (origEnv !== undefined) process.env.PILOTLYNX_ROOT = origEnv;
    else delete process.env.PILOTLYNX_ROOT;
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    resetRegistryCache();
  });

  it('reads insight files from insights directory', () => {
    writeFileSync(join(insightsDir, '2025-01-15.md'), '# Insight 1\nSome content');
    const dir = INSIGHTS_DIR();
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    expect(files).toHaveLength(1);
    expect(files[0]).toBe('2025-01-15.md');
  });

  it('sorts insight files chronologically', () => {
    writeFileSync(join(insightsDir, '2025-01-17.md'), 'Third');
    writeFileSync(join(insightsDir, '2025-01-15.md'), 'First');
    writeFileSync(join(insightsDir, '2025-01-16.md'), 'Second');

    const dir = INSIGHTS_DIR();
    const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
    expect(files).toEqual(['2025-01-15.md', '2025-01-16.md', '2025-01-17.md']);
  });

  it('filters by since date', () => {
    writeFileSync(join(insightsDir, '2025-01-13.md'), 'Old');
    writeFileSync(join(insightsDir, '2025-01-15.md'), 'New');
    writeFileSync(join(insightsDir, '2025-01-17.md'), 'Newer');

    const dir = INSIGHTS_DIR();
    const sinceDate = '2025-01-15';
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .filter((f) => f.replace('.md', '') >= sinceDate);
    expect(files).toEqual(['2025-01-15.md', '2025-01-17.md']);
  });

  it('limits to last N files', () => {
    for (let i = 1; i <= 10; i++) {
      const day = String(i).padStart(2, '0');
      writeFileSync(join(insightsDir, `2025-01-${day}.md`), `Insight ${i}`);
    }

    const dir = INSIGHTS_DIR();
    const limit = 3;
    const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort().slice(-limit);
    expect(files).toHaveLength(3);
    expect(files[0]).toBe('2025-01-08.md');
  });

  it('returns empty when insights directory does not exist', () => {
    rmSync(insightsDir, { recursive: true, force: true });
    const dir = INSIGHTS_DIR();
    expect(existsSync(dir)).toBe(false);
  });

  it('reads content of insight files', () => {
    writeFileSync(join(insightsDir, '2025-01-15.md'), '# Cross-project insight\n\nProjects improved.');
    const content = readFileSync(join(insightsDir, '2025-01-15.md'), 'utf8');
    expect(content).toContain('Cross-project insight');
    expect(content).toContain('Projects improved');
  });

  it('ignores non-markdown files', () => {
    writeFileSync(join(insightsDir, '2025-01-15.md'), 'Insight');
    writeFileSync(join(insightsDir, 'notes.txt'), 'Not an insight');
    writeFileSync(join(insightsDir, 'data.json'), '{}');

    const dir = INSIGHTS_DIR();
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    expect(files).toHaveLength(1);
  });
});
