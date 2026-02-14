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
 * Daily Feedback Workflow — Self-Improvement Agent
 *
 * This workflow receives distilled feedback from the PilotLynx improvement analyzer
 * and applies targeted improvements to the project's configuration, skills, rules,
 * and memory files.
 *
 * ## How This Works
 * 1. PilotLynx analyzes recent logs across all projects (read-only)
 * 2. It produces per-project structured feedback with action items
 * 3. This workflow receives that feedback and executes the improvements
 * 4. Only THIS agent modifies project files — PilotLynx never writes directly
 *
 * ## Evolvable Targets (Risk Tiers)
 *
 * ### LOW RISK — Safe to modify freely
 *
 * **memory/** — Durable project knowledge
 * - Add entries in format: `- [YYYY-MM-DD] **<title>**: <description> (source: improve)`
 * - Append to appropriate section: Decisions, Patterns, Gotchas, or Corrections
 * - Never delete existing entries
 * - Record improvements made as memory entries for audit trail
 *
 * **.claude/skills/*.md** — Reusable capabilities
 * - Create skills from repeating patterns identified in feedback
 * - Before creating: `Glob .claude/skills/*.md` and check for overlap with existing skills
 * - Maximum 3 new skills per improvement cycle to prevent sprawl
 * - Each skill file should have: title, description, when to use, implementation pattern
 * - Name skills descriptively: `api-retry-pattern.md`, `error-categorization.md`
 *
 * ### MEDIUM RISK — Read existing state first, proceed with care
 *
 * **.claude/rules/*.md** — Project conventions
 * - Add rules for conventions discovered in feedback
 * - Before creating: read all existing rules to check for conflicts
 * - Rules should be specific and enforceable, not vague guidance
 * - Example: "All API calls must use explicit timeouts" not "Be careful with APIs"
 *
 * **PROJECT_BRIEF.md** — Key decisions and goals
 * - Append new decisions or updated goals only
 * - NEVER rewrite or remove existing content
 * - Add entries at the end of the appropriate section
 *
 * **RUNBOOK.md** — Operational procedures
 * - Append new procedures discovered from workflow patterns
 * - NEVER rewrite or remove existing content
 * - Add entries at the end of the appropriate section
 *
 * ### HIGH RISK — Only modify when feedback explicitly instructs
 *
 * **CLAUDE.md** — Project operating rules
 * - ONLY modify if the improvement feedback explicitly says "update CLAUDE.md"
 * - When updating: append to existing sections, never restructure
 * - This is the project's core instruction set — changes must be deliberate
 *
 * ### BLOCKED — Never modify these files
 *
 * **.mcp.json** — MCP server configuration
 * - Do NOT modify directly — too risky for automated changes
 * - Instead: write recommendations to `memory/mcp-recommendations.md`
 * - Include: what to add/change, why, and expected benefit
 *
 * **.claude/settings.json** — Claude Code settings
 * - NEVER modify under any circumstances
 *
 * **.claude/settings.local.json** — Local Claude Code settings
 * - NEVER modify under any circumstances
 *
 * ## Anti-Pattern Awareness
 * Before creating skills or rules, check `shared/docs/anti-patterns/` (if accessible)
 * for patterns known to cause problems. Do not create skills that implement anti-patterns.
 *
 * ## Output Requirements
 * After completing all improvements, produce a structured summary:
 * - List every file modified with what changed
 * - List every skill created with name and purpose
 * - List every rule created with name and purpose
 * - List every memory entry added
 * - List any feedback items skipped and why (e.g., skill already exists, blocked file)
 */
export async function run(config: WorkflowConfig): Promise<WorkflowResult> {
  return {
    success: true,
    summary: 'Daily feedback workflow completed.',
    outputs: {},
  };
}
