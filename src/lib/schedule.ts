import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { Cron } from 'croner';
import { z } from 'zod';
import { getProjectDir, getConfigRoot } from './config.js';
import { ScheduleConfigSchema, ScheduleStateSchema, ImproveStateSchema } from './types.js';
import type { ScheduleConfig, ScheduleState, ScheduleEntry } from './types.js';

export function loadScheduleConfig(project: string): ScheduleConfig | null {
  const filePath = join(getProjectDir(project), 'schedule.yaml');
  if (!existsSync(filePath)) return null;
  const raw = parseYaml(readFileSync(filePath, 'utf8'));
  return ScheduleConfigSchema.parse(raw);
}

export function loadScheduleState(project: string): ScheduleState {
  const filePath = join(getProjectDir(project), 'schedule-state.json');
  if (!existsSync(filePath)) return { lastRuns: {} };
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    return ScheduleStateSchema.parse(raw);
  } catch (err) {
    console.warn(`[pilotlynx] Warning: schedule state corrupt for ${project}, resetting. Scheduled workflows may re-run.`, err instanceof Error ? err.message : err);
    return { lastRuns: {} };
  }
}

export function saveScheduleState(project: string, state: ScheduleState): void {
  const filePath = join(getProjectDir(project), 'schedule-state.json');
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmpPath, filePath);
}

export function loadImproveState(): z.infer<typeof ImproveStateSchema> {
  const filePath = join(getConfigRoot(), 'improve-state.json');
  if (!existsSync(filePath)) return ImproveStateSchema.parse({});
  try {
    return ImproveStateSchema.parse(JSON.parse(readFileSync(filePath, 'utf8')));
  } catch (err) {
    console.warn('[pilotlynx] Warning: improve state corrupt, resetting. Circuit breakers will be lost.', err instanceof Error ? err.message : err);
    return ImproveStateSchema.parse({});
  }
}

export function saveImproveState(state: z.infer<typeof ImproveStateSchema>): void {
  const filePath = join(getConfigRoot(), 'improve-state.json');
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmpPath, filePath);
}

export function getMissedRuns(
  cronExpr: string,
  lastRun: Date | null,
  now: Date,
  tz: string,
  maxLookbackDays: number = 7,
): Date[] {
  const startFrom = lastRun ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const maxLookback = new Date(now.getTime() - maxLookbackDays * 24 * 60 * 60 * 1000);
  const effectiveStart = startFrom < maxLookback ? maxLookback : startFrom;

  const job = new Cron(cronExpr, { timezone: tz });
  const runs: Date[] = [];
  let next = job.nextRun(effectiveStart);
  while (next && next <= now) {
    runs.push(next);
    next = job.nextRun(new Date(next.getTime() + 1000));
  }
  return runs;
}

export function applyCatchUpPolicy(
  runs: Date[],
  policy: ScheduleEntry['catchUpPolicy']
): Date[] {
  if (runs.length === 0) return [];
  switch (policy) {
    case 'run_all':
      return runs;
    case 'run_latest':
      return [runs[runs.length - 1]];
    case 'skip':
      return [];
    default:
      return [runs[runs.length - 1]];
  }
}

export interface ScheduledRun {
  workflow: string;
  runTime: Date;
}

export function evaluateSchedules(
  config: ScheduleConfig,
  state: ScheduleState,
  now: Date
): ScheduledRun[] {
  const result: ScheduledRun[] = [];

  for (const entry of config.schedules) {
    const lastRunStr = state.lastRuns[entry.workflow];
    const lastRun = lastRunStr ? new Date(lastRunStr) : null;

    const missedRuns = getMissedRuns(entry.cron, lastRun, now, entry.timezone, entry.maxLookbackDays);
    const runsToExecute = applyCatchUpPolicy(missedRuns, entry.catchUpPolicy);

    for (const runTime of runsToExecute) {
      result.push({ workflow: entry.workflow, runTime });
    }
  }

  return result;
}
