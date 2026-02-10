import { readdirSync, existsSync, cpSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECTS_DIR, TEMPLATE_DIR, getProjectDir, CONFIG_DIR_NAME } from './config.js';
import { getRegisteredProjects, isRegistered, registerProject } from './registry.js';
import type { VerificationResult } from './types.js';

export function listProjects(): string[] {
  const projects = getRegisteredProjects();
  return Object.keys(projects);
}

export function projectExists(name: string): boolean {
  if (!isRegistered(name)) return false;
  const dir = getProjectDir(name);
  return existsSync(dir) && statSync(dir).isDirectory();
}

export function createProjectFromTemplate(name: string): void {
  if (name === CONFIG_DIR_NAME) {
    throw new Error(`"${CONFIG_DIR_NAME}" is reserved and cannot be used as a project name`);
  }

  const projectDir = join(PROJECTS_DIR(), name);
  if (existsSync(projectDir)) {
    throw new Error(`Project "${name}" already exists at ${projectDir}`);
  }

  const templateDir = TEMPLATE_DIR();
  if (!existsSync(templateDir)) {
    throw new Error(`Template directory not found at ${templateDir}`);
  }

  cpSync(templateDir, projectDir, { recursive: true });
  walkAndReplace(projectDir, '{{PROJECT_NAME}}', name);
  registerProject(name, projectDir);
}

export function addScaffolding(name: string, projectDir: string): { added: string[]; skipped: string[] } {
  const added: string[] = [];
  const skipped: string[] = [];
  const templateDir = TEMPLATE_DIR();

  const templateFiles = [
    'PROJECT_BRIEF.md', 'CLAUDE.md', 'RUNBOOK.md', '.mcp.json',
    '.gitignore', 'schedule.yaml',
  ];
  for (const file of templateFiles) {
    const dest = join(projectDir, file);
    if (existsSync(dest)) {
      skipped.push(file);
    } else {
      const src = join(templateDir, file);
      if (existsSync(src)) {
        cpSync(src, dest);
        added.push(file);
      }
    }
  }

  const dirs = [
    'workflows', 'memory', 'artifacts', 'logs',
    join('.claude', 'skills'), join('.claude', 'rules'),
  ];
  for (const d of dirs) {
    const dest = join(projectDir, d);
    if (!existsSync(dest)) {
      mkdirSync(dest, { recursive: true });
      added.push(d + '/');
    }
  }

  const settingsDest = join(projectDir, '.claude', 'settings.json');
  if (!existsSync(settingsDest)) {
    const settingsSrc = join(templateDir, '.claude', 'settings.json');
    if (existsSync(settingsSrc)) {
      cpSync(settingsSrc, settingsDest);
      added.push('.claude/settings.json');
    }
  }

  // Replace {{PROJECT_NAME}} in newly created files only
  for (const file of added) {
    const filePath = join(projectDir, file);
    if (existsSync(filePath) && statSync(filePath).isFile()) {
      const content = readFileSync(filePath, 'utf8');
      if (content.includes('{{PROJECT_NAME}}')) {
        writeFileSync(filePath, content.replaceAll('{{PROJECT_NAME}}', name), 'utf8');
      }
    }
  }

  return { added, skipped };
}

function walkAndReplace(dir: string, search: string, replacement: string): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkAndReplace(fullPath, search, replacement);
    } else if (entry.isFile()) {
      const content = readFileSync(fullPath, 'utf8');
      if (content.includes(search)) {
        writeFileSync(fullPath, content.replaceAll(search, replacement), 'utf8');
      }
    }
  }
}

export function verifyProject(name: string): VerificationResult {
  const projectDir = getProjectDir(name);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!existsSync(projectDir)) {
    return { valid: false, errors: [`Project directory not found: ${projectDir}`], warnings: [] };
  }

  const requiredFiles = ['CLAUDE.md', 'PROJECT_BRIEF.md', 'RUNBOOK.md'];
  for (const file of requiredFiles) {
    if (!existsSync(join(projectDir, file))) {
      errors.push(`Missing required file: ${file}`);
    }
  }

  const requiredDirs = ['workflows', 'memory'];
  for (const d of requiredDirs) {
    const dirPath = join(projectDir, d);
    if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
      errors.push(`Missing required directory: ${d}/`);
    }
  }

  const workflowsDir = join(projectDir, 'workflows');
  if (existsSync(workflowsDir) && statSync(workflowsDir).isDirectory()) {
    const workflowFiles = readdirSync(workflowsDir).filter(
      (f) => f.endsWith('.ts') || f.endsWith('.js')
    );
    if (workflowFiles.length === 0) {
      warnings.push('workflows/ directory is empty (no .ts or .js files)');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
