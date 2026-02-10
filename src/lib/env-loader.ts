import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'node:fs';

export function loadRootEnv(envPath: string): Record<string, string> {
  if (!existsSync(envPath)) return {};
  return dotenv.parse(readFileSync(envPath, 'utf8'));
}
