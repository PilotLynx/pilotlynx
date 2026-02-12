import { execFileSync } from 'node:child_process';
import { listProjects } from '../project.js';
import { getRecentLogs } from '../observation.js';
import { getRegisteredProjects } from '../registry.js';
import { loadScheduleConfig, loadImproveState } from '../schedule.js';
import { loadWorkspaceConfig, getConfigRoot } from '../config.js';
import { loadRelayConfig } from '../relay/config.js';
import { Cron } from 'croner';

export interface ProjectStatus {
  name: string;
  path: string;
  lastRun: string | null;
  lastStatus: 'OK' | 'FAIL' | null;
  cost7d: number;
  nextScheduled: string | null;
}

export interface StatusResult {
  projects: ProjectStatus[];
  scheduledWorkflows: number;
  nextGlobalRun: string | null;
  cronInstalled: boolean;
  configRoot: string;
  relayConfigured: boolean;
  autoImproveEnabled: boolean;
  lastImproveRun: string | null;
}

export function getWorkspaceStatus(): StatusResult {
  const projectNames = listProjects();
  const registered = getRegisteredProjects();
  const configRoot = getConfigRoot();

  const projects: ProjectStatus[] = [];
  let scheduledWorkflows = 0;
  let nextGlobalRun: Date | null = null;

  for (const name of projectNames) {
    const entry = registered[name];
    const logs = getRecentLogs(name, 7);
    const lastLog = logs.length > 0 ? logs[logs.length - 1] : null;
    const cost7d = logs.reduce((sum, l) => sum + l.costUsd, 0);

    let nextScheduled: string | null = null;
    try {
      const schedConfig = loadScheduleConfig(name);
      if (schedConfig) {
        scheduledWorkflows += schedConfig.schedules.length;
        const now = new Date();
        for (const sched of schedConfig.schedules) {
          const job = new Cron(sched.cron, { timezone: sched.timezone });
          const next = job.nextRun(now);
          if (next) {
            if (!nextScheduled || next.toISOString() < nextScheduled) {
              nextScheduled = next.toISOString();
            }
            if (!nextGlobalRun || next < nextGlobalRun) {
              nextGlobalRun = next;
            }
          }
        }
      }
    } catch {
      // Skip projects with invalid schedule configs
    }

    projects.push({
      name,
      path: entry?.path ?? name,
      lastRun: lastLog?.startedAt ?? null,
      lastStatus: lastLog ? (lastLog.success ? 'OK' : 'FAIL') : null,
      cost7d,
      nextScheduled,
    });
  }

  // Check cron installation
  let cronInstalled = false;
  try {
    const crontab = execFileSync('crontab', ['-l'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    cronInstalled = crontab.includes('plynx') && crontab.includes('tick');
  } catch {
    // No crontab or command not available
  }

  // Relay config
  let relayConfigured = false;
  try {
    const relayConfig = loadRelayConfig();
    relayConfigured = relayConfig?.enabled ?? false;
  } catch {
    // Relay not configured
  }

  // Workspace config
  let autoImproveEnabled = true;
  try {
    const wsConfig = loadWorkspaceConfig();
    autoImproveEnabled = wsConfig.autoImprove.enabled;
  } catch {
    // Default to true
  }

  const improveState = loadImproveState();

  return {
    projects,
    scheduledWorkflows,
    nextGlobalRun: nextGlobalRun?.toISOString() ?? null,
    cronInstalled,
    configRoot,
    relayConfigured,
    autoImproveEnabled,
    lastImproveRun: improveState.lastRun,
  };
}
