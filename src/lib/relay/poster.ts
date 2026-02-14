import { execFileSync } from 'node:child_process';
import { containsPotentialSecrets } from '../callbacks.js';
import type { RelayRunResult } from './types.js';

const MAX_OUTPUT_CHARS = 40_000;
const TRUNCATION_THRESHOLD = 12_000;

/**
 * Split a long response into parts that fit within maxLen.
 * Splits at paragraph boundaries first, then line boundaries, then hard-splits.
 * Numbers parts "[1/N]", "[2/N]" when there are multiple.
 */
export function formatResponse(text: string, maxLen: number): string[] {
  if (text.length > TRUNCATION_THRESHOLD) {
    text = text.slice(0, TRUNCATION_THRESHOLD) +
      '\n\n_Response truncated. Full output available as file._';
  }

  if (text.length <= maxLen) {
    return [text];
  }

  const chunks: string[] = [];

  // Split at paragraph boundaries (double newline)
  const paragraphs = text.split(/\n\n+/);
  let current = '';

  for (const para of paragraphs) {
    if (para.length > maxLen) {
      // Flush current buffer
      if (current.length > 0) {
        chunks.push(current.trimEnd());
        current = '';
      }
      // Split long paragraph at line boundaries
      const lines = para.split('\n');
      for (const line of lines) {
        if (line.length > maxLen) {
          // Flush current
          if (current.length > 0) {
            chunks.push(current.trimEnd());
            current = '';
          }
          // Hard-split
          for (let i = 0; i < line.length; i += maxLen) {
            chunks.push(line.slice(i, i + maxLen));
          }
        } else if (current.length + line.length + 1 > maxLen) {
          chunks.push(current.trimEnd());
          current = line;
        } else {
          current += (current.length > 0 ? '\n' : '') + line;
        }
      }
    } else if (current.length + para.length + 2 > maxLen) {
      chunks.push(current.trimEnd());
      current = para;
    } else {
      current += (current.length > 0 ? '\n\n' : '') + para;
    }
  }

  if (current.length > 0) {
    chunks.push(current.trimEnd());
  }

  // Number parts if multiple
  if (chunks.length > 1) {
    const total = chunks.length;
    return chunks.map((c, i) => `[${i + 1}/${total}]\n${c}`);
  }

  return chunks;
}

/**
 * Build a cost/usage footer for a relay run result.
 */
export function addCostFooter(result: RelayRunResult): string {
  const dur = Math.round(result.durationMs / 1000);
  const cost = result.costUsd.toFixed(4);
  const model = result.model ?? 'unknown';
  return `_Model: ${model} | Cost: $${cost} | Tokens: ${result.inputTokens} in / ${result.outputTokens} out | Duration: ${dur}s | Turns: ${result.numTurns}_`;
}

/**
 * Run `git diff --stat` in a project directory.
 * Returns the output or null if not a git repo / no changes.
 */
export function getGitDiffSummary(projectDir: string): string | null {
  try {
    const diff = execFileSync('git', ['diff', '--stat'], {
      cwd: projectDir,
      timeout: 5000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return diff.length > 0 ? diff : null;
  } catch {
    return null;
  }
}

/**
 * Multi-stage sanitization of agent output before posting to chat.
 *
 * Stage 1: Pattern-based secret detection (redact matched patterns)
 * Stage 2: Literal env value replacement
 * Stage 3: Length cap
 */
export function sanitizeAgentOutput(
  text: string,
  projectEnv: Record<string, string>,
): string {
  let sanitized = text;

  // Stage 1: Pattern-based secret detection — always run all patterns
  const patterns = [
    /(?:sk|pk|api|key|token|secret|password|auth)[-_]?[a-zA-Z0-9]{20,}/gi,
    /AIza[0-9A-Za-z_-]{35}/g,
    /ghp_[0-9a-zA-Z]{36}/g,
    /(?:AKIA|ASIA)[0-9A-Z]{16}/g,
    /xox[bporas]-[0-9a-zA-Z-]{10,}/g,
    /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
    /sk-ant-[a-zA-Z0-9_-]{20,}/g,
    /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+/g,
    /[a-z]+:\/\/[^:]+:[^@]+@[^\s]+/g,
    /xapp-[0-9a-zA-Z-]{10,}/g,
  ];
  for (const pattern of patterns) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  // Stage 2: Literal env value replacement
  for (const [key, value] of Object.entries(projectEnv)) {
    if (value.length > 3) {
      // Use split/join for literal replacement (no regex special chars issues)
      while (sanitized.includes(value)) {
        sanitized = sanitized.split(value).join(`[ENV:${key}]`);
      }
    }
  }

  // Stage 3: Length cap
  if (sanitized.length > MAX_OUTPUT_CHARS) {
    sanitized = sanitized.slice(0, MAX_OUTPUT_CHARS) + '\n[output truncated]';
  }

  return sanitized;
}
