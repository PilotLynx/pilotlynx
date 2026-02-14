import type { CanUseToolResult } from './types.js';
import { resolve, basename } from 'node:path';
import { bashCommandEscapesDir } from './bash-security.js';
import { detectSandbox, wrapInSandbox } from './sandbox.js';

// Files that feedback agents must never write to
const FEEDBACK_DENIED_FILES = [
  '.mcp.json',
  '.claude/settings.json',
  '.claude/settings.local.json',
];

export function pathEnforcementCallback(
  projectDir: string,
  additionalDirs: string[] = [],
): (toolName: string, input: unknown) => Promise<CanUseToolResult> {
  const resolvedProjectDir = resolve(projectDir);
  const prefix = resolvedProjectDir + '/';
  const resolvedAdditionalDirs = additionalDirs.map(d => resolve(d));

  function isAllowedPath(filePath: string): boolean {
    const resolved = resolve(filePath);
    if (resolved === resolvedProjectDir || resolved.startsWith(prefix)) return true;
    for (const dir of resolvedAdditionalDirs) {
      const dirPrefix = dir + '/';
      if (resolved === dir || resolved.startsWith(dirPrefix)) return true;
    }
    return false;
  }

  return async (toolName: string, input: unknown): Promise<CanUseToolResult> => {
    // Enforce Read/Write/Edit to project directory + additional directories
    if (['Read', 'Write', 'Edit'].includes(toolName)) {
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

export function feedbackPathEnforcementCallback(
  projectDir: string,
  additionalDirs: string[] = [],
): (toolName: string, input: unknown) => Promise<CanUseToolResult> {
  const resolvedProjectDir = resolve(projectDir);
  const prefix = resolvedProjectDir + '/';
  const resolvedAdditionalDirs = additionalDirs.map(d => resolve(d));

  // Pre-compute denied paths
  const deniedPaths = FEEDBACK_DENIED_FILES.map((f) => resolve(projectDir, f));

  function isAllowedPath(filePath: string): boolean {
    const resolved = resolve(filePath);
    if (resolved === resolvedProjectDir || resolved.startsWith(prefix)) return true;
    for (const dir of resolvedAdditionalDirs) {
      const dirPrefix = dir + '/';
      if (resolved === dir || resolved.startsWith(dirPrefix)) return true;
    }
    return false;
  }

  function isDeniedForWrite(filePath: string): boolean {
    const resolved = resolve(filePath);
    return deniedPaths.some((denied) => resolved === denied);
  }

  return async (toolName: string, input: unknown): Promise<CanUseToolResult> => {
    // For Write/Edit: check deny list first, then allowed path
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
  const resolvedPolicies = resolve(policiesDir);
  const projectPrefix = resolvedProject + '/';
  const policiesPrefix = resolvedPolicies + '/';

  return async (toolName: string, input: unknown): Promise<CanUseToolResult> => {
    if (['Write', 'Edit'].includes(toolName)) {
      const filePath = (input as Record<string, unknown>)?.file_path as string | undefined;
      if (filePath) {
        const resolved = resolve(filePath);
        const inProject = resolved === resolvedProject || resolved.startsWith(projectPrefix);
        const inPolicies = resolved === resolvedPolicies || resolved.startsWith(policiesPrefix);
        if (!inProject && !inPolicies) {
          return { behavior: 'deny', message: `Write restricted to project and policies directories` };
        }
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
