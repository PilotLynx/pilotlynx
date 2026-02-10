import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';

const cache = new Map<string, unknown>();

export function loadPolicy<T>(filePath: string, schema: z.ZodType<T>): T {
  if (cache.has(filePath)) return cache.get(filePath) as T;
  const raw = parseYaml(readFileSync(filePath, 'utf8'));
  const result = schema.parse(raw);
  cache.set(filePath, result);
  return result;
}

export function resetPolicyCache(): void {
  cache.clear();
}
