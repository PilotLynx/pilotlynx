import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { getPackageRoot } from './config.js';

interface PromptFile {
  prompts: Record<string, string>;
  systemPrompts?: Record<string, string>;
}

const cache = new Map<string, PromptFile>();

function getPromptsDir(): string {
  return join(getPackageRoot(), 'prompts');
}

function loadFile(agent: string): PromptFile {
  if (agent.includes('/') || agent.includes('\\') || agent.includes('..')) {
    throw new Error(`Invalid agent name: "${agent}"`);
  }
  if (cache.has(agent)) return cache.get(agent)!;
  const filePath = join(getPromptsDir(), `${agent}.yaml`);
  const raw = parseYaml(readFileSync(filePath, 'utf8')) as PromptFile;
  if (!raw.prompts || typeof raw.prompts !== 'object') {
    throw new Error(`Invalid prompt file for agent "${agent}": missing "prompts" key`);
  }
  cache.set(agent, raw);
  return raw;
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in vars)) {
      throw new Error(`Missing prompt variable: {{${key}}}`);
    }
    return vars[key];
  });
}

export function loadPrompt(agent: string, name: string, vars: Record<string, string> = {}): string {
  const file = loadFile(agent);
  const template = file.prompts[name];
  if (template === undefined) {
    throw new Error(`Prompt "${name}" not found in ${agent}.yaml`);
  }
  return interpolate(template.trimEnd(), vars);
}

export function loadSystemPrompt(agent: string, name: string, vars: Record<string, string> = {}): string | undefined {
  const file = loadFile(agent);
  const template = file.systemPrompts?.[name];
  if (template === undefined) return undefined;
  return interpolate(template.trimEnd(), vars);
}

export function resetPromptCache(): void {
  cache.clear();
}
