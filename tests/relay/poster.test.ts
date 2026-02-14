import { describe, it, expect } from 'vitest';
import {
  formatResponse,
  addCostFooter,
  sanitizeAgentOutput,
} from '../../src/lib/relay/poster.js';
import type { RelayRunResult } from '../../src/lib/relay/types.js';

describe('formatResponse', () => {
  it('returns single chunk for short text', () => {
    const parts = formatResponse('hello world', 4000);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe('hello world');
  });

  it('splits at paragraph boundaries', () => {
    const text = 'paragraph one\n\nparagraph two\n\nparagraph three';
    const parts = formatResponse(text, 25);
    expect(parts.length).toBeGreaterThan(1);
    // Each part should contain whole paragraphs where possible
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(25 + 20); // allow for numbering prefix
    }
  });

  it('numbers multiple parts', () => {
    const text = 'part one\n\npart two\n\npart three';
    const parts = formatResponse(text, 15);
    if (parts.length > 1) {
      expect(parts[0]).toMatch(/^\[1\//);
      expect(parts[parts.length - 1]).toMatch(new RegExp(`^\\[${parts.length}/${parts.length}\\]`));
    }
  });

  it('truncates text exceeding 12K chars', () => {
    const longText = 'a'.repeat(15_000);
    const parts = formatResponse(longText, 40_000);
    const combined = parts.join('');
    expect(combined).toContain('Response truncated');
    expect(combined.length).toBeLessThan(15_000);
  });
});

describe('addCostFooter', () => {
  it('formats cost footer correctly', () => {
    const result: RelayRunResult = {
      success: true,
      text: 'output',
      costUsd: 0.0123,
      inputTokens: 1000,
      outputTokens: 500,
      durationMs: 5400,
      numTurns: 3,
      model: 'claude-sonnet-4-5-20250929',
    };
    const footer = addCostFooter(result);
    expect(footer).toContain('claude-sonnet-4-5-20250929');
    expect(footer).toContain('$0.0123');
    expect(footer).toContain('1000 in');
    expect(footer).toContain('500 out');
    expect(footer).toContain('5s');
    expect(footer).toContain('Turns: 3');
  });

  it('uses "unknown" when model is not provided', () => {
    const result: RelayRunResult = {
      success: true,
      text: '',
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      numTurns: 0,
    };
    const footer = addCostFooter(result);
    expect(footer).toContain('unknown');
  });
});

describe('sanitizeAgentOutput', () => {
  it('redacts secret patterns', () => {
    const text = 'My key is sk-ant-abcdefghijklmnopqrstuvwxyz and token ghp_abcdefghijklmnopqrstuvwxyz1234567890';
    const sanitized = sanitizeAgentOutput(text, {});
    expect(sanitized).toContain('[REDACTED]');
    expect(sanitized).not.toContain('sk-ant-abcdefghijklmnopqrstuvwxyz');
    expect(sanitized).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz1234567890');
  });

  it('replaces env values with [ENV:KEY] markers', () => {
    const text = 'The database url is postgres://myhost:5432/db';
    const env = { DB_URL: 'postgres://myhost:5432/db' };
    const sanitized = sanitizeAgentOutput(text, env);
    expect(sanitized).toContain('[ENV:DB_URL]');
    expect(sanitized).not.toContain('postgres://myhost:5432/db');
  });

  it('respects length cap', () => {
    const text = 'a'.repeat(50_000);
    const sanitized = sanitizeAgentOutput(text, {});
    expect(sanitized.length).toBeLessThanOrEqual(40_000 + 50);
    expect(sanitized).toContain('[output truncated]');
  });

  it('does not replace short env values (<=3 chars)', () => {
    const text = 'abc is a value';
    const env = { SHORT: 'abc' };
    const sanitized = sanitizeAgentOutput(text, env);
    // Short values are skipped to avoid false positives
    expect(sanitized).toBe('abc is a value');
  });
});
