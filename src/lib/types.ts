import { z } from 'zod';

// ── Workspace Config (pilotlynx.yaml) ──

export const WorkspaceConfigSchema = z.object({
  version: z.number(),
  name: z.string(),
  autoImprove: z.object({
    enabled: z.boolean().default(true),
  }).default({ enabled: true }),
  logRetentionDays: z.number().min(1).max(3650).default(90),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

// ── Global Config ──

export const GlobalConfigSchema = z.object({
  configRoot: z.string(),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

// ── Project Registry ──

export const ProjectRegistrySchema = z.object({
  version: z.number(),
  projects: z.record(
    z.string(),
    z.object({
      path: z.string(),
    })
  ),
});

export type ProjectRegistry = z.infer<typeof ProjectRegistrySchema>;

// ── Secrets Access Policy ──

export const SecretsAccessPolicySchema = z.object({
  version: z.number(),
  shared: z.array(z.string()),
  projects: z.record(
    z.string(),
    z.object({
      allowed: z.array(z.string()).optional(),
      mappings: z.record(z.string(), z.string()).optional(),
    }).strict()
  ),
}).strict();

export type SecretsAccessPolicy = z.infer<typeof SecretsAccessPolicySchema>;

// ── Tool Access Policy ──

export const ToolAccessPolicySchema = z.object({
  version: z.number(),
  defaults: z.object({
    allowed: z.array(z.string()),
  }).strict(),
  projects: z.record(
    z.string(),
    z.object({
      allowed: z.array(z.string()).optional(),
      disallowed: z.array(z.string()).optional(),
    }).strict()
  ),
}).strict();

export type ToolAccessPolicy = z.infer<typeof ToolAccessPolicySchema>;

// ── Schedule ──

export const ScheduleEntrySchema = z.object({
  workflow: z.string(),
  cron: z.string(),
  timezone: z.string().default('UTC'),
  catchUpPolicy: z.enum(['run_all', 'run_latest', 'skip']).default('run_latest'),
  maxLookbackDays: z.number().min(1).max(365).default(7),
  model: z.string().optional(),
  maxBudgetUsd: z.number().positive().optional(),
});

export const ScheduleConfigSchema = z.object({
  schedules: z.array(ScheduleEntrySchema),
});

export type ScheduleEntry = z.infer<typeof ScheduleEntrySchema>;
export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;

// ── Schedule State ──

export const ScheduleStateSchema = z.object({
  lastRuns: z.record(z.string(), z.string()),
});

export type ScheduleState = z.infer<typeof ScheduleStateSchema>;

// ── Run Records ──

export interface RunRecord {
  project: string;
  workflow: string;
  startedAt: string;
  completedAt: string;
  success: boolean;
  summary: string;
  costUsd: number;
  numTurns: number;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  model?: string;
  relayContext?: {
    platform: string;
    channelId: string;
    conversationId: string;
    userId: string;
  };
}

// ── Workflow Config / Result ──

/** Used by template workflow files for type safety. See template/workflows/ */
export interface WorkflowConfig {
  project: string;
  workflow: string;
  prompt?: string;
  env: Record<string, string>;
}

/** Used by template workflow files for type safety. See template/workflows/ */
export interface WorkflowResult {
  success: boolean;
  summary: string;
  outputs: Record<string, unknown>;
}

// ── Agent Runner ──

export interface AgentConfig {
  prompt: string;
  cwd?: string;
  env?: Record<string, string>;
  allowedTools?: string[];
  disallowedTools?: string[];
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string };
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  allowDangerouslySkipPermissions?: boolean;
  maxTurns?: number;
  maxBudgetUsd?: number;
  model?: string;
  additionalDirectories?: string[];
  settingSources?: string[];
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> };
  canUseTool?: (toolName: string, input: unknown) => Promise<CanUseToolResult>;
  agents?: Record<string, AgentDefinition>;
}

/** Reserved for Claude Agent SDK multi-agent delegation. Not yet used by PilotLynx commands. */
export interface AgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
}

export type CanUseToolResult =
  | { behavior: 'allow'; updatedInput: unknown }
  | { behavior: 'deny'; message: string };

export interface AgentResult {
  success: boolean;
  result: string;
  structuredOutput?: unknown;
  costUsd: number;
  durationMs: number;
  numTurns: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  model?: string;
  spans?: TraceSpan[];
}

// ── Verification ──

export interface VerificationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ── Run Tracing ──

export interface TraceSpan {
  type: 'assistant' | 'tool_use' | 'tool_result' | 'result' | 'error';
  timestamp: string;
  durationMs?: number;
  toolName?: string;
  tokens?: { input?: number; output?: number };
  costUsd?: number;
  message?: string;
}

export interface RunTrace {
  runId: string;
  project: string;
  workflow: string;
  startedAt: string;
  spans: TraceSpan[];
}

// ── Audit Trail ──

export interface AuditEntry {
  timestamp: string;
  project: string;
  workflow: string;
  triggeredBy: 'cli' | 'schedule' | 'improve' | 'relay';
  runId: string;
  success: boolean;
  costUsd: number;
  durationMs: number;
  toolInvocations: string[];
  model?: string;
}

// ── Evaluation Framework ──

export interface EvalTestCase {
  name: string;
  workflow: string;
  input: string;
  expectedBehavior: string;
  tags?: string[];
}

export interface EvalResult {
  testCase: string;
  workflow: string;
  passed: boolean;
  score: number;
  reasoning: string;
  costUsd: number;
  timestamp: string;
}

export interface EvalSummary {
  project: string;
  timestamp: string;
  totalCases: number;
  passed: number;
  failed: number;
  avgScore: number;
  results: EvalResult[];
}

// ── Health Score ──

export interface HealthScore {
  score: number;
  trend: 'improving' | 'stable' | 'declining';
  successRate7d: number;
  successRate30d: number;
  avgCost7d: number;
  avgCost30d: number;
}

// ── Improve State (extended) ──

export const ImproveStateSchema = z.object({
  lastRun: z.string().nullable().default(null),
  projectFailures: z.record(z.string(), z.number()).default({}),
});
