import type { CanUseToolResult } from './types.js';
import { resolve, basename } from 'node:path';
import { bashCommandEscapesDir } from './bash-security.js';
import { wrapInSandbox } from './sandbox.js';
import type { SandboxOptions } from './sandbox.js';

// Files that feedback agents must never write to
const FEEDBACK_DENIED_FILES = [
  '.mcp.json',
  '.claude/settings.json',
  '.claude/settings.local.json',
];

// Patterns that indicate potential secrets in file content
const SECRETS_PATTERNS = [
  /(?:sk|pk|api|key|token|secret|password|auth)[-_]?[a-zA-Z0-9]{20,}/i,
  /AIza[0-9A-Za-z_-]{35}/,                       // Google API key
  /ghp_[0-9a-zA-Z]{36}/,                          // GitHub PAT
  /(?:AKIA|ASIA)[0-9A-Z]{16}/,                    // AWS access key
  /xox[bporas]-[0-9a-zA-Z-]{10,}/,                // Slack token
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,      // Private key PEM
  /sk-ant-[a-zA-Z0-9_-]{20,}/,                    // Anthropic API key
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+/,        // JWT token
  /[a-z]+:\/\/[^:]+:[^@]+@[^\s]+/,                // Connection strings with credentials
  /xapp-[0-9a-zA-Z-]{10,}/,                       // Slack app-level token
  /(?:[A-Za-z0-9+/]{4}){10,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)/, // Base64 blocks >40 chars (requires padding suffix)
];

/** Check if content appears to contain secrets/credentials. */
export function containsPotentialSecrets(content: string): string | null {
  for (const pattern of SECRETS_PATTERNS) {
    if (pattern.test(content)) {
      return 'Potential secret pattern detected in output.';
    }
  }
  return null;
}

const MAX_OUTPUT_LENGTH = 40_000;

/**
 * Multi-stage output sanitization for relay mode.
 * Stage 1: Redact known secret patterns.
 * Stage 2: Redact literal env values from project environment.
 * Stage 3: Truncate to length cap.
 */
export function sanitizeAgentOutput(text: string, projectEnv: Record<string, string>): string {
  let sanitized = text;

  // Stage 1: Redact known secret patterns
  for (const pattern of SECRETS_PATTERNS) {
    sanitized = sanitized.replace(new RegExp(pattern.source, pattern.flags + (pattern.flags.includes('g') ? '' : 'g')), '[REDACTED]');
  }

  // Stage 2: Redact literal env values (only values >3 chars to avoid false positives)
  for (const [key, value] of Object.entries(projectEnv)) {
    if (value.length > 3) {
      // Escape special regex chars in the value for safe replacement
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      sanitized = sanitized.replace(new RegExp(escaped, 'g'), `[ENV:${key}]`);
    }
  }

  // Stage 3: Length cap
  if (sanitized.length > MAX_OUTPUT_LENGTH) {
    sanitized = sanitized.slice(0, MAX_OUTPUT_LENGTH) + '\n[Output truncated]';
  }

  return sanitized;
}

/** Returns a function that checks whether a path is inside resolvedDir or any of the additionalDirs. */
function createPathChecker(resolvedDir: string, additionalDirs: string[]): (filePath: string) => boolean {
  const prefix = resolvedDir + '/';
  return (filePath: string): boolean => {
    const resolved = resolve(filePath);
    if (resolved === resolvedDir || resolved.startsWith(prefix)) return true;
    for (const dir of additionalDirs) {
      const dirPrefix = dir + '/';
      if (resolved === dir || resolved.startsWith(dirPrefix)) return true;
    }
    return false;
  };
}

/** Returns a function that checks whether a path matches any of the denied relative file paths. */
function createDeniedPathChecker(projectDir: string, deniedFiles: string[]): (filePath: string) => boolean {
  const deniedPaths = deniedFiles.map((f) => resolve(projectDir, f));
  return (filePath: string): boolean => {
    const resolved = resolve(filePath);
    return deniedPaths.some((denied) => resolved === denied);
  };
}

export function pathEnforcementCallback(
  projectDir: string,
  additionalDirs: string[] = [],
  sandboxOptions?: SandboxOptions,
): (toolName: string, input: unknown) => Promise<CanUseToolResult> {
  const resolvedProjectDir = resolve(projectDir);
  const resolvedAdditionalDirs = additionalDirs.map(d => resolve(d));
  const isAllowedPath = createPathChecker(resolvedProjectDir, resolvedAdditionalDirs);

  return async (toolName: string, input: unknown): Promise<CanUseToolResult> => {
    // Enforce Read/Write/Edit to project directory + additional directories
    if (['Read', 'Write', 'Edit'].includes(toolName)) {
      const filePath = (input as Record<string, unknown>)?.file_path as string | undefined;
      if (filePath && !isAllowedPath(filePath)) {
        return { behavior: 'deny', message: `File access restricted to project directory: ${resolvedProjectDir}` };
      }
    }

    // Output guardrails: check Write/Edit content for secrets
    if (['Write', 'Edit'].includes(toolName)) {
      const content = (input as Record<string, unknown>)?.content as string
        ?? (input as Record<string, unknown>)?.new_string as string
        ?? '';
      const leak = containsPotentialSecrets(content);
      if (leak) {
        return { behavior: 'deny', message: `Output guardrail: ${leak}. Do not write secrets to files.` };
      }
    }

    // Enforce Glob/Grep path restrictions
    if (['Glob', 'Grep'].includes(toolName)) {
      const searchPath = (input as Record<string, unknown>)?.path as string | undefined;
      if (searchPath && !isAllowedPath(searchPath)) {
        return { behavior: 'deny', message: `Search restricted to project directory: ${resolvedProjectDir}` };
      }
    }

    // Enforce Bash commands stay within project directory
    if (toolName === 'Bash') {
      const command = (input as Record<string, unknown>)?.command as string | undefined;
      if (command) {
        if (bashCommandEscapesDir(command, resolvedProjectDir)) {
          return { behavior: 'deny', message: `Bash command references paths outside project directory: ${resolvedProjectDir}` };
        }
        const wrapped = wrapInSandbox(command, resolvedProjectDir, resolvedAdditionalDirs, sandboxOptions);
        if (wrapped !== command) {
          return { behavior: 'allow', updatedInput: { ...(input as Record<string, unknown>), command: wrapped } };
        }
      }
    }

    return { behavior: 'allow', updatedInput: input };
  };
}

export function feedbackPathEnforcementCallback(
  projectDir: string,
  additionalDirs: string[] = [],
): (toolName: string, input: unknown) => Promise<CanUseToolResult> {
  const resolvedProjectDir = resolve(projectDir);
  const resolvedAdditionalDirs = additionalDirs.map(d => resolve(d));
  const isAllowedPath = createPathChecker(resolvedProjectDir, resolvedAdditionalDirs);
  const isDeniedForWrite = createDeniedPathChecker(projectDir, FEEDBACK_DENIED_FILES);

  return async (toolName: string, input: unknown): Promise<CanUseToolResult> => {
    // For Write/Edit: check deny list first, then allowed path, then secrets
    if (['Write', 'Edit'].includes(toolName)) {
      const filePath = (input as Record<string, unknown>)?.file_path as string | undefined;
      if (filePath) {
        if (isDeniedForWrite(filePath)) {
          return { behavior: 'deny', message: `Feedback agents cannot modify ${basename(filePath)}. Write recommendations to memory/ instead.` };
        }
        if (!isAllowedPath(filePath)) {
          return { behavior: 'deny', message: `File access restricted to project directory: ${resolvedProjectDir}` };
        }
      }
      // Output guardrails: check content for secrets
      const content = (input as Record<string, unknown>)?.content as string
        ?? (input as Record<string, unknown>)?.new_string as string
        ?? '';
      const leak = containsPotentialSecrets(content);
      if (leak) {
        return { behavior: 'deny', message: `Output guardrail: ${leak}. Do not write secrets to files.` };
      }
    }

    // Read is allowed for all project files (no deny list for reads)
    if (toolName === 'Read') {
      const filePath = (input as Record<string, unknown>)?.file_path as string | undefined;
      if (filePath && !isAllowedPath(filePath)) {
        return { behavior: 'deny', message: `File access restricted to project directory: ${resolvedProjectDir}` };
      }
    }

    // Enforce Glob/Grep path restrictions
    if (['Glob', 'Grep'].includes(toolName)) {
      const searchPath = (input as Record<string, unknown>)?.path as string | undefined;
      if (searchPath && !isAllowedPath(searchPath)) {
        return { behavior: 'deny', message: `Search restricted to project directory: ${resolvedProjectDir}` };
      }
    }

    // Enforce Bash commands stay within project directory
    if (toolName === 'Bash') {
      const command = (input as Record<string, unknown>)?.command as string | undefined;
      if (command) {
        if (bashCommandEscapesDir(command, resolvedProjectDir)) {
          return { behavior: 'deny', message: `Bash command references paths outside project directory: ${resolvedProjectDir}` };
        }
        const wrapped = wrapInSandbox(command, resolvedProjectDir, resolvedAdditionalDirs);
        if (wrapped !== command) {
          return { behavior: 'allow', updatedInput: { ...(input as Record<string, unknown>), command: wrapped } };
        }
      }
    }

    return { behavior: 'allow', updatedInput: input };
  };
}

export function projectSetupCallback(
  projectDir: string,
  policiesDir: string,
): (toolName: string, input: unknown) => Promise<CanUseToolResult> {
  const resolvedProject = resolve(projectDir);
  const isAllowedPath = createPathChecker(resolvedProject, [resolve(policiesDir)]);

  return async (toolName: string, input: unknown): Promise<CanUseToolResult> => {
    if (['Write', 'Edit'].includes(toolName)) {
      const filePath = (input as Record<string, unknown>)?.file_path as string | undefined;
      if (filePath && !isAllowedPath(filePath)) {
        return { behavior: 'deny', message: `Write restricted to project and policies directories` };
      }
    }

    // Restrict Bash commands to project directory
    if (toolName === 'Bash') {
      const command = (input as Record<string, unknown>)?.command as string | undefined;
      if (command && bashCommandEscapesDir(command, resolvedProject)) {
        return { behavior: 'deny', message: `Bash command references paths outside project directory: ${resolvedProject}` };
      }
    }

    return { behavior: 'allow', updatedInput: input };
  };
}
