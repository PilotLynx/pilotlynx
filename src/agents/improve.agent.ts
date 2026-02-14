import type { AgentConfig, CanUseToolResult } from '../lib/types.js';
import { getConfigRoot, SHARED_DIR, ENV_FILE } from '../lib/config.js';
import { loadPrompt, loadSystemPrompt } from '../lib/prompts.js';
import { resolve, dirname } from 'node:path';

function improveToolCallback(): (toolName: string, input: unknown) => Promise<CanUseToolResult> {
  const envFile = resolve(ENV_FILE());
  const envDir = dirname(envFile);
  return async (toolName: string, input: unknown): Promise<CanUseToolResult> => {
    const filePath = (input as any)?.file_path ?? (input as any)?.path;
    if (filePath) {
      const resolved = resolve(filePath);
      // Deny access to .env files in config root
      if (resolved === envFile || /[/\\]\.env(\..+)?$/.test(resolved)) {
        if (resolved.startsWith(envDir)) {
          return { behavior: 'deny', message: 'Cannot access .env files' };
        }
      }
    }
    return { behavior: 'allow', updatedInput: input };
  };
}

// ── Structured Output Types ──

export interface ProjectFeedback {
  summary: string;
  priority: 'high' | 'medium' | 'low';
  actionItems: string[];
  suggestedSkills?: Array<{ name: string; description: string }>;
  suggestedRules?: Array<{ name: string; content: string }>;
  modifyClaude?: boolean;
}

export interface ImproveInsight {
  id: string;
  category: string;
  insight: string;
  actionable: boolean;
  evidence: string;
  supersedes?: string;
}

export interface ImproveAntiPattern {
  pattern: string;
  reason: string;
  evidence: string;
  applicableTo?: string[];
}

export interface ImproveSharedPattern {
  name: string;
  content: string;
  observations: number;
  applicableTo: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface ImproveOutput {
  projectFeedback: Record<string, ProjectFeedback>;
  crossProjectInsights: ImproveInsight[];
  antiPatterns?: ImproveAntiPattern[];
  sharedPatterns?: ImproveSharedPattern[];
}

export function getImproveAgentConfig(
  logSummaries: Record<string, string>,
  previousInsights?: string,
): AgentConfig {
  const summaryText = Object.entries(logSummaries)
    .map(([project, summary]) => `## ${project}\n${summary}`)
    .join('\n\n');

  const vars: Record<string, string> = {
    summaryText,
    previousInsights: previousInsights
      ? `### Previous Insights (external verification — check if still applicable)\n${previousInsights}`
      : '',
  };

  return {
    prompt: loadPrompt('improve', 'improve_analyze', vars),
    cwd: getConfigRoot(),
    allowedTools: ['Read', 'Glob', 'Grep'],
    // Intentional: uses string systemPrompt (not preset 'claude_code') because
    // this agent is read-only and doesn't need CLAUDE.md context or Claude Code tools.
    systemPrompt: loadSystemPrompt('improve', 'improve_analyze')!,
    maxTurns: 15,
    canUseTool: improveToolCallback(),
    outputFormat: {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          projectFeedback: {
            type: 'object',
            description: 'Map of project name to structured feedback',
            additionalProperties: {
              type: 'object',
              properties: {
                summary: { type: 'string', description: '2-3 sentence overview of key findings' },
                priority: { type: 'string', enum: ['high', 'medium', 'low'] },
                actionItems: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Specific, executable improvement instructions',
                },
                suggestedSkills: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      description: { type: 'string' },
                    },
                    required: ['name', 'description'],
                  },
                  description: 'Skills to create from repeating patterns (max 3)',
                },
                suggestedRules: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      content: { type: 'string' },
                    },
                    required: ['name', 'content'],
                  },
                  description: 'Rules to add for discovered conventions',
                },
                modifyClaude: {
                  type: 'boolean',
                  description: 'Set to true ONLY if CLAUDE.md has a specific gap that needs addressing',
                },
              },
              required: ['summary', 'priority', 'actionItems'],
            },
          },
          crossProjectInsights: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Unique insight ID (e.g., ins-YYYYMMDD-NNN)' },
                category: { type: 'string', description: 'performance, reliability, cost, patterns' },
                insight: { type: 'string', description: 'Abstract insight, no project names or secrets' },
                actionable: { type: 'boolean' },
                evidence: { type: 'string', description: 'What data supports this insight' },
                supersedes: { type: 'string', description: 'ID of insight this replaces, if any' },
              },
              required: ['id', 'category', 'insight', 'actionable', 'evidence'],
            },
            description: 'Cross-project learnings that are abstract and context-free',
          },
          antiPatterns: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                pattern: { type: 'string', description: 'What the anti-pattern is' },
                reason: { type: 'string', description: 'Why it is harmful' },
                evidence: { type: 'string', description: 'What data shows this' },
                applicableTo: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Context tags (e.g., api-integration, data-processing)',
                },
              },
              required: ['pattern', 'reason', 'evidence'],
            },
            description: 'Recurring failures to track as anti-patterns',
          },
          sharedPatterns: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Short descriptive name for the pattern' },
                content: { type: 'string', description: 'Description of the successful pattern' },
                observations: { type: 'number', description: 'Number of independent observations (minimum 3 to promote)' },
                applicableTo: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Context tags for when this pattern applies',
                },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              },
              required: ['name', 'content', 'observations', 'applicableTo', 'confidence'],
            },
            description: 'Successful patterns to promote as shared knowledge (require 3+ observations)',
          },
        },
        required: ['projectFeedback', 'crossProjectInsights'],
      },
    },
  };
}
