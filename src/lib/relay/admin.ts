// ── Admin Command Handler ──
// Handles relay admin commands from Slack slash commands and text-based commands.

import type Database from 'better-sqlite3';
import type { RelayConfig } from './types.js';
import { listProjects } from '../project.js';
import { lookupBinding, saveBinding, removeBinding } from './bindings.js';

interface AdminContext {
  db: Database.Database;
  platform: string;
  channelId: string;
  userId: string;
  config: RelayConfig;
  getQueueDepth?: (project: string) => number;
  getActiveCount?: () => number;
  startedAt?: Date;
}

const KNOWN_COMMANDS = new Set([
  'bind', 'unbind', 'where', 'projects', 'status', 'help', 'cost', 'cancel', 'new',
]);

const ADMIN_ONLY = new Set(['bind', 'unbind', 'projects']);

/**
 * Parse a text string into an admin command.
 * Matches: /pilotlynx-<cmd>, /pilotlynx <cmd>, or !<cmd>.
 */
export function parseCommand(text: string): { command: string; args: string } | null {
  const trimmed = text.trim();

  // /pilotlynx-<command> [args]
  const slashDash = trimmed.match(/^\/pilotlynx-(\S+)\s*(.*)?$/i);
  if (slashDash) {
    const cmd = slashDash[1].toLowerCase();
    if (KNOWN_COMMANDS.has(cmd)) return { command: cmd, args: (slashDash[2] ?? '').trim() };
  }

  // /pilotlynx <command> [args]
  const slashSpace = trimmed.match(/^\/pilotlynx\s+(\S+)\s*(.*)?$/i);
  if (slashSpace) {
    const cmd = slashSpace[1].toLowerCase();
    if (KNOWN_COMMANDS.has(cmd)) return { command: cmd, args: (slashSpace[2] ?? '').trim() };
  }

  // !<command> [args]
  const bang = trimmed.match(/^!(\S+)\s*(.*)?$/);
  if (bang) {
    const cmd = bang[1].toLowerCase();
    if (KNOWN_COMMANDS.has(cmd)) return { command: cmd, args: (bang[2] ?? '').trim() };
  }

  return null;
}

/**
 * Check whether a user is an admin on the given platform.
 */
export function isAdmin(config: RelayConfig, platform: string, userId: string): boolean {
  const admins = config.admins[platform as keyof typeof config.admins];
  if (!admins) return false;
  return admins.includes(userId);
}

/**
 * Execute an admin command and return the response text.
 */
export async function handleAdminCommand(
  ctx: AdminContext,
  command: string,
  args: string,
): Promise<string> {
  if (ADMIN_ONLY.has(command) && !isAdmin(ctx.config, ctx.platform, ctx.userId)) {
    return 'Permission denied. This command requires admin access.';
  }

  switch (command) {
    case 'bind':
      return handleBind(ctx, args);
    case 'unbind':
      return handleUnbind(ctx);
    case 'where':
      return handleWhere(ctx);
    case 'projects':
      return handleProjects();
    case 'status':
      return handleStatus(ctx);
    case 'help':
      return handleHelp();
    case 'cost':
      return handleCost(ctx);
    case 'cancel':
      return 'Cancellation requested.';
    case 'new':
      return 'Starting fresh context.';
    default:
      return `Unknown command: ${command}. Type "help" for available commands.`;
  }
}

function handleBind(ctx: AdminContext, args: string): string {
  const project = args.trim();
  if (!project) return 'Usage: bind <project>';

  const all = listProjects();
  if (!all.includes(project)) {
    return `Project "${project}" not found. Registered projects: ${all.join(', ') || '(none)'}`;
  }

  saveBinding(ctx.db, ctx.platform, ctx.channelId, project, ctx.userId);
  return `Channel bound to project *${project}*.`;
}

function handleUnbind(ctx: AdminContext): string {
  removeBinding(ctx.db, ctx.platform, ctx.channelId);
  return 'Channel binding removed.';
}

function handleWhere(ctx: AdminContext): string {
  const project = lookupBinding(ctx.db, ctx.platform, ctx.channelId);
  if (!project) return 'This channel is not bound to any project.';
  return `This channel is bound to *${project}*.`;
}

function handleProjects(): string {
  const all = listProjects();
  if (all.length === 0) return 'No registered projects.';
  return `Registered projects:\n${all.map((p) => `  - ${p}`).join('\n')}`;
}

function handleStatus(ctx: AdminContext): string {
  const uptime = ctx.startedAt
    ? formatUptime(Date.now() - ctx.startedAt.getTime())
    : 'unknown';
  const active = ctx.getActiveCount?.() ?? 0;

  const lines = [
    `Relay status:`,
    `  Uptime: ${uptime}`,
    `  Active runs: ${active}`,
  ];

  if (ctx.getQueueDepth) {
    const project = lookupBinding(ctx.db, ctx.platform, ctx.channelId);
    if (project) {
      const depth = ctx.getQueueDepth(project);
      lines.push(`  Queue depth (${project}): ${depth}`);
    }
  }

  return lines.join('\n');
}

function handleHelp(): string {
  return [
    'PilotLynx Relay Commands:',
    '  bind <project>  - Bind this channel to a project (admin)',
    '  unbind          - Remove channel binding (admin)',
    '  where           - Show current binding',
    '  projects        - List registered projects (admin)',
    '  status          - Show relay status',
    '  cost            - Show cost stats for bound project',
    '  cancel          - Cancel the active run',
    '  new             - Start a fresh conversation context',
    '  help            - Show this help text',
  ].join('\n');
}

function handleCost(ctx: AdminContext): string {
  const project = lookupBinding(ctx.db, ctx.platform, ctx.channelId);
  if (!project) return 'This channel is not bound to a project. Use "bind <project>" first.';

  const row = ctx.db
    .prepare(
      `SELECT COUNT(*) as runs, COALESCE(SUM(cost_usd), 0) as total_cost,
              COALESCE(SUM(input_tokens), 0) as total_input,
              COALESCE(SUM(output_tokens), 0) as total_output
       FROM relay_runs WHERE project = ?`,
    )
    .get(project) as
    | { runs: number; total_cost: number; total_input: number; total_output: number }
    | undefined;

  if (!row || row.runs === 0) return `No runs recorded for *${project}*.`;

  return [
    `Cost stats for *${project}*:`,
    `  Total runs: ${row.runs}`,
    `  Total cost: $${row.total_cost.toFixed(4)}`,
    `  Total tokens: ${row.total_input + row.total_output} (${row.total_input} in / ${row.total_output} out)`,
  ].join('\n');
}

function formatUptime(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);

  if (days > 0) return `${days}d ${hrs % 24}h`;
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  if (mins > 0) return `${mins}m ${secs % 60}s`;
  return `${secs}s`;
}
