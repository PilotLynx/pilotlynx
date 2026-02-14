import { existsSync, accessSync, constants, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigRoot, SHARED_DOCS_DIR } from '../config.js';
import { getGlobalConfigPath } from '../global-config.js';
import { getRegisteredProjects } from '../registry.js';
import { loadPolicy, resetPolicyCache } from '../policy.js';
import { SecretsAccessPolicySchema, ToolAccessPolicySchema } from '../types.js';
import { isScheduleCronInstalled } from '../cron.js';
import type { SharedPattern } from '../observation.js';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  suggestion?: string;
}

export function runDoctorChecks(): CheckResult[] {
  const checks: CheckResult[] = [];

  // 1. Global config exists and is readable
  const globalConfigPath = getGlobalConfigPath();
  if (existsSync(globalConfigPath)) {
    checks.push({ name: 'Global config', status: 'pass', message: globalConfigPath });
  } else {
    checks.push({
      name: 'Global config',
      status: 'warn',
      message: 'Not found',
      suggestion: 'Run `pilotlynx init` to create a workspace and register it globally.',
    });
  }

  // 2. Config root exists and is writable
  let configRoot: string;
  try {
    configRoot = getConfigRoot();
    try {
      accessSync(configRoot, constants.W_OK);
      checks.push({ name: 'Config root', status: 'pass', message: configRoot });
    } catch {
      checks.push({
        name: 'Config root',
        status: 'fail',
        message: `Not writable: ${configRoot}`,
        suggestion: 'Check directory permissions.',
      });
    }
  } catch {
    checks.push({
      name: 'Config root',
      status: 'fail',
      message: 'Could not resolve config root',
      suggestion: 'Run `pilotlynx init` to create a workspace.',
    });
    return checks;
  }

  // 3. Workspace marker exists
  const markerPath = join(configRoot, 'pilotlynx.yaml');
  if (existsSync(markerPath)) {
    checks.push({ name: 'Workspace marker', status: 'pass', message: 'pilotlynx.yaml found' });
  } else {
    checks.push({
      name: 'Workspace marker',
      status: 'fail',
      message: 'pilotlynx.yaml not found in config root',
      suggestion: 'Config root may be corrupt. Re-run `pilotlynx init`.',
    });
  }

  // 4. .env file exists
  const envPath = join(configRoot, '.env');
  if (existsSync(envPath)) {
    checks.push({ name: '.env file', status: 'pass', message: '.env found' });
  } else {
    checks.push({
      name: '.env file',
      status: 'warn',
      message: '.env not found in config root',
      suggestion: `Create ${envPath} and add your API keys (e.g. ANTHROPIC_API_KEY).`,
    });
  }

  // 5. Projects registry valid
  try {
    const projects = getRegisteredProjects();
    const missing: string[] = [];
    for (const [name, entry] of Object.entries(projects)) {
      if (!existsSync(entry.path)) {
        missing.push(name);
      }
    }
    if (missing.length === 0) {
      const count = Object.keys(projects).length;
      checks.push({
        name: 'Project registry',
        status: 'pass',
        message: `${count} project(s), all paths valid`,
      });
    } else {
      checks.push({
        name: 'Project registry',
        status: 'warn',
        message: `Missing directories: ${missing.join(', ')}`,
        suggestion: `Remove stale entries with \`pilotlynx remove <name>\` or recreate the directories.`,
      });
    }
  } catch (err) {
    checks.push({
      name: 'Project registry',
      status: 'fail',
      message: `Error reading registry: ${err instanceof Error ? err.message : String(err)}`,
      suggestion: 'Check projects.yaml for syntax errors.',
    });
  }

  // 6. Secrets policy parseable
  const secretsPolicyPath = join(configRoot, 'shared', 'policies', 'secrets-access.yaml');
  if (existsSync(secretsPolicyPath)) {
    try {
      resetPolicyCache();
      loadPolicy(secretsPolicyPath, SecretsAccessPolicySchema);
      checks.push({ name: 'Secrets policy', status: 'pass', message: 'Valid' });
    } catch (err) {
      checks.push({
        name: 'Secrets policy',
        status: 'fail',
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
        suggestion: 'Fix syntax in shared/policies/secrets-access.yaml.',
      });
    }
  } else {
    checks.push({
      name: 'Secrets policy',
      status: 'warn',
      message: 'Not found',
      suggestion: 'Create shared/policies/secrets-access.yaml to control secret access.',
    });
  }

  // 7. Tool policy parseable
  const toolPolicyPath = join(configRoot, 'shared', 'policies', 'tool-access.yaml');
  if (existsSync(toolPolicyPath)) {
    try {
      resetPolicyCache();
      loadPolicy(toolPolicyPath, ToolAccessPolicySchema);
      checks.push({ name: 'Tool policy', status: 'pass', message: 'Valid' });
    } catch (err) {
      checks.push({
        name: 'Tool policy',
        status: 'fail',
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
        suggestion: 'Fix syntax in shared/policies/tool-access.yaml.',
      });
    }
  } else {
    checks.push({
      name: 'Tool policy',
      status: 'warn',
      message: 'Not found',
      suggestion: 'Create shared/policies/tool-access.yaml to control tool access.',
    });
  }

  // 8. Cron job installed
  try {
    if (isScheduleCronInstalled()) {
      checks.push({ name: 'Cron job', status: 'pass', message: 'pilotlynx schedule tick installed' });
    } else {
      checks.push({
        name: 'Cron job',
        status: 'warn',
        message: 'Not installed',
        suggestion: 'Install with: */15 * * * * pilotlynx schedule tick >> /tmp/pilotlynx-tick.log 2>&1',
      });
    }
  } catch {
    checks.push({
      name: 'Cron job',
      status: 'warn',
      message: 'Could not check crontab',
      suggestion: 'crontab command not available on this system.',
    });
  }

  // 9. Template directory exists
  const templateDir = join(configRoot, 'template');
  if (existsSync(templateDir)) {
    checks.push({ name: 'Template directory', status: 'pass', message: 'Found' });
  } else {
    checks.push({
      name: 'Template directory',
      status: 'warn',
      message: 'Not found in config root',
      suggestion: 'Run `pilotlynx init` or copy the bundled template to pilotlynx/template/.',
    });
  }

  // 10. Expired shared patterns
  try {
    const patternsDir = join(SHARED_DOCS_DIR(), 'patterns');
    if (existsSync(patternsDir)) {
      const now = new Date();
      const files = readdirSync(patternsDir).filter((f) => f.endsWith('.json'));
      let expiredCount = 0;
      for (const file of files) {
        try {
          const content = readFileSync(join(patternsDir, file), 'utf8');
          const pattern = JSON.parse(content) as SharedPattern;
          if (new Date(pattern.expiresAt) < now) {
            expiredCount++;
          }
        } catch {
          // Skip corrupt files
        }
      }
      if (expiredCount === 0) {
        checks.push({ name: 'Shared patterns', status: 'pass', message: 'No expired patterns' });
      } else {
        checks.push({
          name: 'Shared patterns',
          status: 'warn',
          message: `${expiredCount} expired pattern(s) found`,
          suggestion: 'Expired patterns are filtered from reads but still occupy disk. Run improve to regenerate or manually remove them.',
        });
      }
    }
  } catch {
    // Non-fatal — skip if patterns dir is inaccessible
  }

  return checks;
}
