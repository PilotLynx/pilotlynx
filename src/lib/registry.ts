import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, isAbsolute, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getConfigRoot, getWorkspaceRoot } from './config.js';
import { ProjectRegistrySchema, type ProjectRegistry } from './types.js';
import { validateProjectName } from './validation.js';

let _cache: ProjectRegistry | null = null;

export function resetRegistryCache(): void {
  _cache = null;
}

function registryFile(): string {
  return join(getConfigRoot(), 'projects.yaml');
}

export function loadRegistry(): ProjectRegistry {
  if (_cache) return _cache;

  const file = registryFile();
  if (!existsSync(file)) {
    const empty: ProjectRegistry = { version: 1, projects: {} };
    _cache = empty;
    return empty;
  }

  const raw = parseYaml(readFileSync(file, 'utf8'));
  const registry = ProjectRegistrySchema.parse(raw);
  _cache = registry;
  return registry;
}

export function saveRegistry(registry: ProjectRegistry): void {
  const file = registryFile();
  writeFileSync(file, stringifyYaml(registry), 'utf8');
  _cache = registry;
}

export function registerProject(name: string, absolutePath: string): void {
  validateProjectName(name);

  const registry = loadRegistry();

  if (registry.projects[name]) {
    throw new Error(`Project "${name}" is already registered`);
  }

  // Check for duplicate paths
  const resolvedNew = resolve(absolutePath);
  for (const [existingName, entry] of Object.entries(registry.projects)) {
    const existingAbs = isAbsolute(entry.path)
      ? entry.path
      : join(getWorkspaceRoot(), entry.path);
    if (resolve(existingAbs) === resolvedNew) {
      throw new Error(
        `Path "${absolutePath}" is already registered as project "${existingName}"`
      );
    }
  }

  // Store relative if under workspace root, absolute otherwise
  const wsRoot = getWorkspaceRoot();
  const rel = relative(wsRoot, resolvedNew);
  const storedPath = rel.startsWith('..') || isAbsolute(rel) ? resolvedNew : rel;

  registry.projects[name] = { path: storedPath };
  saveRegistry(registry);
}

export function unregisterProject(name: string): void {
  const registry = loadRegistry();
  if (!registry.projects[name]) {
    throw new Error(`Project "${name}" is not registered`);
  }
  delete registry.projects[name];
  saveRegistry(registry);
}

export function resolveProjectPath(name: string): string {
  const registry = loadRegistry();
  const entry = registry.projects[name];
  if (!entry) {
    throw new Error(
      `Project "${name}" is not registered. Run \`plynx project add ${name}\` to register it.`
    );
  }
  if (isAbsolute(entry.path)) return entry.path;
  return join(getWorkspaceRoot(), entry.path);
}

export function isRegistered(name: string): boolean {
  const registry = loadRegistry();
  return name in registry.projects;
}

export function getRegisteredProjects(): Record<string, { path: string; absolutePath: string }> {
  const registry = loadRegistry();
  const result: Record<string, { path: string; absolutePath: string }> = {};
  const wsRoot = getWorkspaceRoot();

  for (const [name, entry] of Object.entries(registry.projects)) {
    const absolutePath = isAbsolute(entry.path)
      ? entry.path
      : join(wsRoot, entry.path);
    result[name] = { path: entry.path, absolutePath };
  }

  return result;
}
