import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectDir } from './config.js';
import type { EpisodicMemoryEntry } from './types.js';

/**
 * Append an episodic memory entry to the project's episodes.jsonl file.
 * Each entry is a single line of JSON — queryable by date, workflow, tags.
 */
export function writeEpisode(project: string, entry: EpisodicMemoryEntry): void {
  const memoryDir = join(getProjectDir(project), 'memory');
  mkdirSync(memoryDir, { recursive: true });

  const filePath = join(memoryDir, 'episodes.jsonl');
  appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
}

/**
 * Read episodic memory entries, optionally filtered by criteria.
 */
export function readEpisodes(
  project: string,
  options?: {
    workflow?: string;
    tags?: string[];
    limit?: number;
    result?: 'success' | 'failure';
  },
): EpisodicMemoryEntry[] {
  const filePath = join(getProjectDir(project), 'memory', 'episodes.jsonl');
  if (!existsSync(filePath)) return [];

  const lines = readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((l) => l.trim());

  let entries: EpisodicMemoryEntry[] = [];

  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as EpisodicMemoryEntry);
    } catch {
      // Skip corrupt lines
    }
  }

  // Apply filters
  if (options?.workflow) {
    entries = entries.filter((e) => e.workflow === options.workflow);
  }
  if (options?.result) {
    entries = entries.filter((e) => e.result === options.result);
  }
  if (options?.tags && options.tags.length > 0) {
    entries = entries.filter((e) =>
      options.tags!.some((tag) => e.tags.includes(tag)),
    );
  }

  // Most recent first
  entries.sort((a, b) => b.date.localeCompare(a.date));

  if (options?.limit) {
    entries = entries.slice(0, options.limit);
  }

  return entries;
}

/**
 * Build an episodic memory entry from a run result.
 */
export function buildEpisode(
  workflow: string,
  success: boolean,
  costUsd: number,
  keyDecisions: string[],
  tags: string[],
): EpisodicMemoryEntry {
  return {
    date: new Date().toISOString(),
    workflow,
    result: success ? 'success' : 'failure',
    cost: costUsd,
    keyDecisions,
    tags,
  };
}
