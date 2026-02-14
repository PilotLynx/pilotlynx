interface WorkflowConfig {
  project: string;
  workflow: string;
  prompt?: string;
  env: Record<string, string>;
}

interface WorkflowResult {
  success: boolean;
  summary: string;
  outputs: Record<string, unknown>;
}

/**
 * Project Review Workflow — Health Report Generator
 *
 * Produces a structured project health report by examining the project's current state.
 * Writes the report to `artifacts/review-YYYY-MM-DD.md`.
 *
 * ## What to Examine
 *
 * ### 1. Project Configuration Health
 * - Read `PROJECT_BRIEF.md` — is it filled in or still template defaults?
 * - Read `CLAUDE.md` — are there project-specific rules beyond the template?
 * - Read `RUNBOOK.md` — are operational procedures documented?
 * - Check `.mcp.json` — are MCP servers configured?
 *
 * ### 2. Skill Inventory
 * - Glob `.claude/skills/*.md` — list all skills
 * - For each skill: name, brief description, estimated relevance
 * - Flag skills that may be outdated or overlapping
 *
 * ### 3. Rule Inventory
 * - Glob `.claude/rules/*.md` — list all rules
 * - Check for conflicting rules
 * - Flag overly vague rules that aren't actionable
 *
 * ### 4. Memory Health
 * - Read `memory/MEMORY.md` — count entries per section
 * - Flag if memory is empty (no learnings captured)
 * - Flag if memory has no recent entries (stale project)
 *
 * ### 5. Workflow Status
 * - Glob `workflows/*.ts` — list available workflows
 * - Read recent logs from `logs/` (last 5 entries)
 * - Calculate: success rate, average cost, failure patterns
 *
 * ### 6. Shared Pattern Adoption
 * - If `shared/docs/patterns/` is accessible, check which patterns apply to this project
 * - Report which applicable patterns are adopted vs. not adopted
 *
 * ### 7. Anti-Pattern Compliance
 * - If `shared/docs/anti-patterns/` is accessible, check for violations
 * - Report any code or configuration matching known anti-patterns
 *
 * ### 8. Cost Trends
 * - Analyze log entries for cost data (costUsd field)
 * - Calculate: total spend, average per workflow, trend direction
 * - Flag anomalies (sudden cost spikes or drops)
 *
 * ## Output Format
 * Write the report to `artifacts/review-YYYY-MM-DD.md` with sections matching the above.
 * Include a summary section at the top with overall health score (healthy/needs-attention/critical).
 *
 * Also produce a brief summary in the workflow result for the orchestrator.
 */
export async function run(config: WorkflowConfig): Promise<WorkflowResult> {
  return {
    success: true,
    summary: 'Project review workflow completed.',
    outputs: {},
  };
}
