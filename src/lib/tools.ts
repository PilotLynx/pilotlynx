import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { POLICIES_DIR } from './config.js';
import { loadPolicy } from './policy.js';
import { ToolAccessPolicySchema } from './types.js';

export interface ProjectToolPolicy {
  allowedTools: string[];
  disallowedTools: string[];
}

export function buildProjectTools(projectName: string): ProjectToolPolicy {
  const policyPath = join(POLICIES_DIR(), 'tool-access.yaml');
  if (!existsSync(policyPath)) {
    return { allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'], disallowedTools: [] };
  }

  const policy = loadPolicy(policyPath, ToolAccessPolicySchema);
  const projectOverrides = policy.projects[projectName];

  if (projectOverrides?.allowed) {
    // Project specifies an explicit allowlist — use it directly
    return {
      allowedTools: projectOverrides.allowed,
      disallowedTools: projectOverrides.disallowed ?? [],
    };
  }

  // Use defaults, apply any project-level disallowed list
  return {
    allowedTools: policy.defaults.allowed,
    disallowedTools: projectOverrides?.disallowed ?? [],
  };
}
