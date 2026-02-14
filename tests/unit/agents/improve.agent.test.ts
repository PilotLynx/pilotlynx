import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetConfigCache, CONFIG_DIR_NAME } from '../../../src/lib/config.js';
import { resetPolicyCache } from '../../../src/lib/policy.js';
import { getImproveAgentConfig } from '../../../src/agents/improve.agent.js';

describe('getImproveAgentConfig', () => {
  let tmpDir: string;
  let configDir: string;
  const origEnv = process.env.PILOTLYNX_ROOT;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pilotlynx-improve-agent-'));
    configDir = join(tmpDir, CONFIG_DIR_NAME);
    process.env.PILOTLYNX_ROOT = configDir;
    resetConfigCache();
    resetPolicyCache();

    mkdirSync(join(configDir, 'shared', 'policies'), { recursive: true });
    writeFileSync(join(configDir, 'projects.yaml'), 'version: 1\nprojects: {}\n');
  });

  afterEach(() => {
    if (origEnv !== undefined) process.env.PILOTLYNX_ROOT = origEnv;
    else delete process.env.PILOTLYNX_ROOT;
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigCache();
    resetPolicyCache();
  });

  it('has read-only tools', () => {
    const config = getImproveAgentConfig({ proj1: 'some logs' });
    expect(config.allowedTools).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('callback denies access to .env files', async () => {
    const envFile = join(configDir, '.env');
    writeFileSync(envFile, 'SECRET=value');
    const config = getImproveAgentConfig({ proj1: 'some logs' });
    const callback = config.canUseTool!;
    const result = await callback('Read', { file_path: envFile });
    expect(result.behavior).toBe('deny');
  });

  it('callback allows reading non-.env files', async () => {
    const config = getImproveAgentConfig({ proj1: 'some logs' });
    const callback = config.canUseTool!;
    const result = await callback('Read', { file_path: join(tmpDir, 'some', 'file.md') });
    expect(result.behavior).toBe('allow');
  });

  it('has JSON schema output format', () => {
    const config = getImproveAgentConfig({ proj1: 'logs' });
    expect(config.outputFormat).toBeDefined();
    expect(config.outputFormat!.type).toBe('json_schema');
  });

  it('sets maxTurns to 15', () => {
    const config = getImproveAgentConfig({ proj1: 'logs' });
    expect(config.maxTurns).toBe(15);
  });

  it('has structured projectFeedback schema with priority and actionItems', () => {
    const config = getImproveAgentConfig({ proj1: 'logs' });
    const schema = config.outputFormat!.schema;
    const feedbackSchema = (schema.properties as any).projectFeedback;
    expect(feedbackSchema.additionalProperties.properties).toHaveProperty('priority');
    expect(feedbackSchema.additionalProperties.properties).toHaveProperty('actionItems');
    expect(feedbackSchema.additionalProperties.properties).toHaveProperty('suggestedSkills');
    expect(feedbackSchema.additionalProperties.properties).toHaveProperty('modifyClaude');
    expect(feedbackSchema.additionalProperties.required).toContain('summary');
    expect(feedbackSchema.additionalProperties.required).toContain('priority');
    expect(feedbackSchema.additionalProperties.required).toContain('actionItems');
  });

  it('has array-based crossProjectInsights schema', () => {
    const config = getImproveAgentConfig({ proj1: 'logs' });
    const schema = config.outputFormat!.schema;
    const insightsSchema = (schema.properties as any).crossProjectInsights;
    expect(insightsSchema.type).toBe('array');
    expect(insightsSchema.items.properties).toHaveProperty('id');
    expect(insightsSchema.items.properties).toHaveProperty('category');
    expect(insightsSchema.items.properties).toHaveProperty('insight');
    expect(insightsSchema.items.properties).toHaveProperty('actionable');
    expect(insightsSchema.items.properties).toHaveProperty('evidence');
  });

  it('has antiPatterns schema', () => {
    const config = getImproveAgentConfig({ proj1: 'logs' });
    const schema = config.outputFormat!.schema;
    const antiPatternsSchema = (schema.properties as any).antiPatterns;
    expect(antiPatternsSchema.type).toBe('array');
    expect(antiPatternsSchema.items.properties).toHaveProperty('pattern');
    expect(antiPatternsSchema.items.properties).toHaveProperty('reason');
    expect(antiPatternsSchema.items.properties).toHaveProperty('evidence');
  });

  it('has sharedPatterns schema', () => {
    const config = getImproveAgentConfig({ proj1: 'logs' });
    const schema = config.outputFormat!.schema;
    const sharedPatternsSchema = (schema.properties as any).sharedPatterns;
    expect(sharedPatternsSchema.type).toBe('array');
    expect(sharedPatternsSchema.items.properties).toHaveProperty('name');
    expect(sharedPatternsSchema.items.properties).toHaveProperty('content');
    expect(sharedPatternsSchema.items.properties).toHaveProperty('observations');
    expect(sharedPatternsSchema.items.properties).toHaveProperty('applicableTo');
    expect(sharedPatternsSchema.items.properties).toHaveProperty('confidence');
  });

  it('accepts previousInsights parameter', () => {
    const config = getImproveAgentConfig({ proj1: 'logs' }, 'Some previous insight');
    expect(config.prompt).toContain('Previous Insights');
  });

  it('handles undefined previousInsights', () => {
    const config = getImproveAgentConfig({ proj1: 'logs' });
    // Should not throw, prompt should still be valid
    expect(config.prompt).toBeDefined();
  });
});
