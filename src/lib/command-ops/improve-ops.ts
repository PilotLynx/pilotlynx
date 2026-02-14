import { existsSync, mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import chalk from 'chalk';
import { listProjects } from '../project.js';
import {
  getRecentLogs,
  getLogStatistics,
  writeStructuredInsights,
  readRecentInsights,
  writeSharedPattern,
  writeAntiPattern,
  writeFeedbackLog,
  readFeedbackLog,
  type StructuredInsight,
  type FeedbackLogEntry,
} from '../observation.js';
import { getImproveAgentConfig, type ImproveOutput, type ProjectFeedback } from '../../agents/improve.agent.js';
import { runAgent } from '../agent-runner.js';
import { buildProjectEnv } from '../secrets.js';
import { getRunAgentConfig } from '../../agents/run.agent.js';
import { getProjectDir, INSIGHTS_DIR } from '../config.js';
import { resetPolicyCache } from '../policy.js';
import { loadImproveState, saveImproveState } from '../schedule.js';
import type { RunRecord } from '../types.js';

// ── Public Types ──

export interface ImproveOptions {
  dryRun?: boolean;
  budget?: number;
  days?: number;
  revert?: string;
}

export interface ImproveResult {
  success: boolean;
  error?: string;
  failures?: Array<{ project: string; error: string }>;
  noProjects?: boolean;
  noActivity?: boolean;
  noFeedback?: boolean;
  dryRunOutput?: ImproveOutput;
  totalCostUsd?: number;
}

// ── Revert ──

const BACKUP_DIR_NAME = '.improve-backup';

export async function executeRevert(project: string): Promise<{ success: boolean; error?: string }> {
  const projectDir = getProjectDir(project);
  const backupDir = join(projectDir, 'artifacts', BACKUP_DIR_NAME);

  if (!existsSync(backupDir)) {
    return { success: false, error: `No backup found for "${project}". Run \`pilotlynx improve\` first.` };
  }

  const targets = ['CLAUDE.md', 'memory', '.claude/skills', '.claude/rules'];
  let restored = 0;

  for (const target of targets) {
    const src = join(backupDir, target);
    const dest = join(projectDir, target);
    if (existsSync(src)) {
      cpSync(src, dest, { recursive: true, force: true });
      restored++;
    }
  }

  return restored > 0
    ? { success: true }
    : { success: false, error: 'Backup directory exists but contains no recognized files.' };
}

// ── Main Improve Loop ──

export async function executeImprove(options?: ImproveOptions): Promise<ImproveResult> {
  const { dryRun, budget, days = 7 } = options ?? {};

  const projects = listProjects();
  if (projects.length === 0) {
    return { success: true, noProjects: true };
  }

  // ── Phase 0: Auto-clean orphaned improve-backup dirs ──
  for (const project of projects) {
    const backupDir = join(getProjectDir(project), 'artifacts', BACKUP_DIR_NAME);
    if (existsSync(backupDir)) {
      try {
        rmSync(backupDir, { recursive: true, force: true });
      } catch {
        // Non-fatal — skip if cleanup fails
      }
    }
  }

  const improveState = loadImproveState();

  // ── Phase 1: Build rich log summaries ──
  const logSummaries: Record<string, string> = {};

  for (const project of projects) {
    const logs = getRecentLogs(project, days);

    if (logs.length === 0) {
      const bootstrap = generateBootstrapFeedback(project);
      if (bootstrap) {
        logSummaries[project] = bootstrap;
      }
      continue;
    }

    logSummaries[project] = buildRichLogSummary(project, logs, days);
  }

  if (Object.keys(logSummaries).length === 0) {
    return { success: true, noActivity: true };
  }

  // ── Phase 2: Inject previous insights (Reflexion pattern) ──
  const previousInsights = buildPreviousInsightsContext();

  // ── Phase 3: Run improve agent ──
  let totalCost = 0;
  let result: Awaited<ReturnType<typeof runAgent>>;

  try {
    const config = getImproveAgentConfig(logSummaries, previousInsights || undefined);
    if (budget) config.maxBudgetUsd = budget;
    result = await runAgent(config);
    totalCost += result.costUsd;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Improve agent failed: ${msg}` };
  }

  if (!result.success) {
    return { success: false, error: result.result };
  }

  const output = result.structuredOutput as ImproveOutput | null;

  if (!output) {
    return { success: true, noFeedback: true };
  }

  // ── Dry-run: return output without dispatching ──
  if (dryRun) {
    return { success: true, dryRunOutput: output, totalCostUsd: totalCost };
  }

  // ── Phase 4: Write cross-project artifacts ──
  if (output.crossProjectInsights && output.crossProjectInsights.length > 0) {
    const now = new Date().toISOString().split('T')[0];
    const structured: StructuredInsight[] = output.crossProjectInsights.map((i) => ({
      ...i,
      date: now,
    }));
    writeStructuredInsights(structured);
  }

  if (output.antiPatterns && output.antiPatterns.length > 0) {
    for (const ap of output.antiPatterns) {
      writeAntiPattern(ap.pattern.slice(0, 40), {
        ...ap,
        applicableTo: ap.applicableTo ?? [],
        createdAt: new Date().toISOString(),
      });
    }
  }

  if (output.sharedPatterns && output.sharedPatterns.length > 0) {
    const now = new Date().toISOString();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + ninetyDaysMs).toISOString();
    for (const sp of output.sharedPatterns) {
      // Only promote patterns with 3+ observations (quality gate)
      if (sp.observations >= 3) {
        writeSharedPattern(sp.name, {
          name: sp.name,
          content: sp.content,
          observations: sp.observations,
          applicableTo: sp.applicableTo,
          confidence: sp.confidence,
          createdAt: now,
          expiresAt,
        });
      }
    }
  }

  // ── Phase 5: Dispatch feedback to projects ──
  const feedbackWorkflow = 'daily_feedback';
  const failures: Array<{ project: string; error: string }> = [];
  const feedbackLogEntries: FeedbackLogEntry[] = [];

  for (const [project, feedback] of Object.entries(output.projectFeedback)) {
    if (!feedback || !feedback.summary) continue;

    // Circuit breaker: skip projects with 3+ consecutive failures
    const projectFailCount = improveState.projectFailures[project] ?? 0;
    if (projectFailCount >= 3) {
      console.log(chalk.yellow(`[pilotlynx] Skipping "${project}": ${projectFailCount} consecutive failures. Reset with a successful manual run.`));
      continue;
    }

    const workflowPath = join(getProjectDir(project), 'workflows', `${feedbackWorkflow}.ts`);
    if (!existsSync(workflowPath)) {
      console.log(chalk.dim(`[pilotlynx] Skipping "${project}": no ${feedbackWorkflow} workflow found.`));
      continue;
    }

    // Budget check
    if (budget && totalCost >= budget) {
      console.log(chalk.yellow(`[pilotlynx] Budget limit ($${budget}) reached. Skipping remaining projects.`));
      break;
    }

    // Pre-improve snapshot
    createSnapshot(project);

    // Serialize structured feedback for the run agent prompt
    const feedbackText = serializeFeedback(feedback);

    try {
      resetPolicyCache();
      const projectEnv = buildProjectEnv(project);
      const feedbackConfig = getRunAgentConfig(project, feedbackWorkflow, projectEnv, feedbackText);
      if (budget) feedbackConfig.maxBudgetUsd = Math.max(0, budget - totalCost);
      const feedbackResult = await runAgent(feedbackConfig);
      totalCost += feedbackResult.costUsd;

      if (!feedbackResult.success) {
        failures.push({ project, error: feedbackResult.result });
        feedbackLogEntries.push({ date: new Date().toISOString(), project, actedOn: false, outcome: 'agent_failed' });
        improveState.projectFailures[project] = projectFailCount + 1;
      } else {
        feedbackLogEntries.push({ date: new Date().toISOString(), project, actedOn: true, outcome: 'applied' });
        improveState.projectFailures[project] = 0;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ project, error: msg });
      feedbackLogEntries.push({ date: new Date().toISOString(), project, actedOn: false, outcome: msg });
      improveState.projectFailures[project] = projectFailCount + 1;
    }
  }

  // ── Phase 6: Write feedback tracking and improve log ──
  writeFeedbackLog(feedbackLogEntries);
  writeImproveLog(output, failures, totalCost);
  improveState.lastRun = new Date().toISOString();
  saveImproveState(improveState);

  return {
    success: failures.length === 0,
    failures: failures.length > 0 ? failures : undefined,
    totalCostUsd: totalCost,
  };
}

// ── Helpers ──

function buildRichLogSummary(project: string, logs: RunRecord[], days: number): string {
  const sections: string[] = [];

  // Recent full records (most recent 5)
  const recentLogs = logs.slice(-5);
  const recentSection = recentLogs
    .map((l) => {
      const parts = [`[${l.workflow}] ${l.success ? 'OK' : 'FAIL'}: ${l.summary}`];
      if (l.costUsd) parts.push(`cost=$${l.costUsd.toFixed(4)}`);
      if (l.numTurns) parts.push(`turns=${l.numTurns}`);
      if (l.error) parts.push(`error: ${l.error.slice(0, 100)}`);
      return parts.join(' | ');
    })
    .join('\n');
  sections.push(`### Recent Runs (last ${recentLogs.length})\n${recentSection}`);

  // Aggregate statistics (if there are more than 5 logs)
  if (logs.length > 5) {
    const stats = getLogStatistics(project, days);
    const statsSection = [
      `Total runs: ${stats.totalRuns}, Success: ${stats.successCount}, Failed: ${stats.failureCount} (${(stats.failureRate * 100).toFixed(0)}%)`,
      `Avg cost: $${stats.avgCostUsd.toFixed(4)}, Total cost: $${stats.totalCostUsd.toFixed(4)}`,
      `Avg turns: ${stats.avgTurns.toFixed(1)}`,
    ];
    if (stats.topErrors.length > 0) {
      statsSection.push(`Top errors: ${stats.topErrors.join('; ')}`);
    }
    sections.push(`### Aggregate (${days}d)\n${statsSection.join('\n')}`);
  }

  return sections.join('\n\n');
}

function buildPreviousInsightsContext(): string | null {
  const sections: string[] = [];

  // Previous insights
  const insights = readRecentInsights(3);
  if (insights.length > 0) {
    const insightLines = insights
      .slice(0, 10) // Cap to 10 individual insights
      .map((i) => `- [${i.category}] ${i.insight} (evidence: ${i.evidence})`)
      .join('\n');
    sections.push(`Previous insights:\n${insightLines}`);
  }

  // Feedback effectiveness from prior cycles
  const feedbackLog = readFeedbackLog();
  if (feedbackLog.length > 0) {
    const recent = feedbackLog.slice(-20); // Last 20 entries
    const actedCount = recent.filter((e) => e.actedOn).length;
    const failedCount = recent.filter((e) => !e.actedOn).length;
    const failedProjects = [...new Set(recent.filter((e) => !e.actedOn).map((e) => e.project))];
    const lines: string[] = [];
    lines.push(`Feedback acted on: ${actedCount}/${recent.length} (${failedCount} failed)`);
    if (failedProjects.length > 0) {
      lines.push(`Projects with failed feedback: ${failedProjects.join(', ')}`);
    }
    sections.push(`Previous feedback effectiveness:\n${lines.join('\n')}`);
  }

  return sections.length > 0 ? sections.join('\n\n') : null;
}

function generateBootstrapFeedback(project: string): string | null {
  const projectDir = getProjectDir(project);

  // Check if project has default/unfilled content
  const briefPath = join(projectDir, 'PROJECT_BRIEF.md');
  const skillsDir = join(projectDir, '.claude', 'skills');
  const memoryPath = join(projectDir, 'memory', 'MEMORY.md');
  const mcpPath = join(projectDir, '.mcp.json');
  const runbookPath = join(projectDir, 'RUNBOOK.md');
  const workflowsDir = join(projectDir, 'workflows');

  const hasDefaultBrief = existsSync(briefPath) && isTemplateDefault(briefPath);
  const hasNoSkills = !existsSync(skillsDir) || readdirSync(skillsDir).filter((f) => f.endsWith('.md')).length === 0;
  const hasDefaultMemory = existsSync(memoryPath) && isTemplateDefault(memoryPath);
  const hasEmptyMcp = existsSync(mcpPath) && isEmptyMcpJson(mcpPath);
  const hasIncompleteRunbook = existsSync(runbookPath) && readFileSync(runbookPath, 'utf8').length < 200;
  const hasEmptyWorkflows = !existsSync(workflowsDir) || readdirSync(workflowsDir).filter((f) => f.endsWith('.ts')).length === 0;

  if (!hasDefaultBrief && !hasNoSkills && !hasEmptyMcp && !hasIncompleteRunbook && !hasEmptyWorkflows) return null;

  const items: string[] = [];
  items.push('### Bootstrap (new project with no activity)');
  if (hasDefaultBrief) items.push('- PROJECT_BRIEF.md has template defaults — fill in project goals and key decisions');
  if (hasNoSkills) items.push('- No skills defined — create project-specific skills in .claude/skills/');
  if (hasDefaultMemory) items.push('- Memory is empty — record initial decisions and setup patterns');
  if (hasEmptyMcp) items.push('- .mcp.json is empty or has default template content — configure project-scoped MCP servers');
  if (hasIncompleteRunbook) items.push('- RUNBOOK.md is incomplete (< 200 chars) — document operational procedures');
  if (hasEmptyWorkflows) items.push('- No workflows defined — create workflow files in workflows/');

  return items.join('\n');
}

function isTemplateDefault(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, 'utf8');
    return content.includes('{{PROJECT_NAME}}') || content.includes('<!-- Record ') || content.length < 200;
  } catch {
    return false;
  }
}

function isEmptyMcpJson(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, 'utf8').trim();
    if (content === '{}' || content === '{ }') return true;
    const parsed = JSON.parse(content);
    return Object.keys(parsed).length === 0;
  } catch {
    return false;
  }
}

function serializeFeedback(feedback: ProjectFeedback): string {
  const sections: string[] = [];

  sections.push(`**Priority: ${feedback.priority}**`);
  sections.push(`**Summary:** ${feedback.summary}`);

  if (feedback.actionItems.length > 0) {
    sections.push('**Action Items:**');
    for (const item of feedback.actionItems) {
      sections.push(`- ${item}`);
    }
  }

  if (feedback.suggestedSkills && feedback.suggestedSkills.length > 0) {
    sections.push('**Suggested Skills:**');
    for (const skill of feedback.suggestedSkills) {
      sections.push(`- **${skill.name}**: ${skill.description}`);
    }
  }

  if (feedback.suggestedRules && feedback.suggestedRules.length > 0) {
    sections.push('**Suggested Rules:**');
    for (const rule of feedback.suggestedRules) {
      sections.push(`- **${rule.name}**: ${rule.content}`);
    }
  }

  if (feedback.modifyClaude) {
    sections.push('**CLAUDE.md Update:** Yes — update CLAUDE.md to address the identified gap.');
  }

  return sections.join('\n');
}

function createSnapshot(project: string): void {
  const projectDir = getProjectDir(project);
  const backupDir = join(projectDir, 'artifacts', BACKUP_DIR_NAME);

  try {
    mkdirSync(backupDir, { recursive: true });

    const targets = [
      { src: 'CLAUDE.md', isDir: false },
      { src: 'memory', isDir: true },
      { src: join('.claude', 'skills'), isDir: true },
      { src: join('.claude', 'rules'), isDir: true },
    ];

    for (const { src, isDir } of targets) {
      const srcPath = join(projectDir, src);
      const destPath = join(backupDir, src);
      if (existsSync(srcPath)) {
        if (isDir) {
          mkdirSync(join(backupDir, basename(src === join('.claude', 'skills') ? '.claude' : src)), { recursive: true });
        }
        cpSync(srcPath, destPath, { recursive: true, force: true });
      }
    }
  } catch {
    // Non-fatal — snapshot is best-effort
    console.error(chalk.dim(`[pilotlynx] Warning: could not create backup for "${project}"`));
  }
}

function writeImproveLog(output: ImproveOutput, failures: Array<{ project: string; error: string }>, totalCost: number): void {
  const projectCount = Object.keys(output.projectFeedback).length;
  const insightCount = output.crossProjectInsights?.length ?? 0;
  const antiPatternCount = output.antiPatterns?.length ?? 0;

  const summary = [
    `Analyzed ${projectCount} project(s)`,
    `${insightCount} insight(s) generated`,
    `${antiPatternCount} anti-pattern(s) identified`,
    failures.length > 0 ? `${failures.length} failure(s)` : 'all feedback applied',
  ].join(', ');

  // Write to a synthetic "improve" project log in the insights directory
  const dir = INSIGHTS_DIR();
  mkdirSync(dir, { recursive: true });

  const now = new Date();
  const record = {
    type: 'improve_cycle',
    timestamp: now.toISOString(),
    summary,
    projectCount,
    insightCount,
    antiPatternCount,
    failures: failures.length,
    totalCostUsd: totalCost,
    projectsFeedback: Object.keys(output.projectFeedback),
  };

  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const logPath = join(dir, `improve-log-${dateStr}.json`);

  try {
    writeFileSync(logPath, JSON.stringify(record, null, 2), 'utf8');
  } catch {
    // Non-fatal
  }
}
