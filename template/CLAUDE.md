# {{PROJECT_NAME}}

## Identity

This is the {{PROJECT_NAME}} project workspace within the PilotLynx monorepo.

## Operating Rules

1. **Stay in scope** — only read/write files within this project directory.
2. **Use durable memory** — record key decisions in PROJECT_BRIEF.md, operational procedures in RUNBOOK.md, and task-level notes in memory/.
3. **No secrets in files** — secrets are injected at runtime via environment variables. Never write secrets to any committed file.
4. **Bounded execution** — workflows have a clear start and end. Do not maintain long-lived sessions.
5. **Skills are patterns** — create skills in .claude/skills/ for repeatable operations.

## Structure

```
CLAUDE.md               — this file (project rules)
PROJECT_BRIEF.md        — key decisions and goals
RUNBOOK.md              — operational procedures
.mcp.json               — project MCP servers
.claude/settings.json   — shared project permissions
.claude/skills/         — project skills
.claude/rules/          — modular topic-specific rules
workflows/              — TypeScript Agent SDK workflows
memory/MEMORY.md        — durable curated memory (human-written)
memory/episodes.jsonl   — structured run history (auto-generated)
memory/procedures/      — executable patterns and recipes
evals/                  — evaluation test cases
artifacts/              — output artifacts (gitignored)
logs/                   — run logs (gitignored)
logs/traces/            — JSONL run traces (gitignored)
logs/audit/             — audit trail entries (gitignored)
```

## Settings

The `.claude/settings.json` file configures Claude Code defaults for this project:

- **Plan mode by default** — Claude proposes changes before executing. Override per-session if needed.
- **Secrets denied** — `.env` files in `pilotlynx/` config directory are blocked from reads.
- **Agent teams enabled** — multi-agent collaboration is available in every session.

## Workflows

- `daily_feedback` — review recent activity and update memory
- `task_execute` — execute a specific task from prompt input
- `project_review` — produce a short project status update

### How Workflows Execute

When `pilotlynx run <project> <workflow>` is invoked:

1. PilotLynx loads the workflow file and injects allowed secrets as environment variables
2. A Claude Agent SDK session starts inside this project directory
3. The agent reads the workflow file as instructions and executes the described task
4. The agent can only access files within this project directory (plus shared docs/insights)
5. A run log is written to `logs/` with the outcome, cost, and duration

Workflow files use TypeScript for structure and type safety, but the agent interprets them
as instructions rather than executing them programmatically. Write workflows as clear
descriptions of what the agent should accomplish.

### Secrets

Secrets are injected at runtime as environment variables. They come from `pilotlynx/.env`
filtered through your project's access policy in `pilotlynx/shared/policies/secrets-access.yaml`.
Use `pilotlynx env <project>` to see which secrets your project has access to.

## Direct Access

When working directly in this project directory (e.g., opening it in Claude Code), PilotLynx needs to know where the workspace config lives. Two options:

1. **Global config** (automatic after `pilotlynx init`) — PilotLynx stores the config path in `~/.config/pilotlynx/config.yaml`. CLI commands work from any directory.
2. **direnv for MCP secrets** — run `pilotlynx link {{PROJECT_NAME}} --direnv` to generate a `.envrc` that exports policy-filtered secrets. Then `direnv allow` to activate.

The `.envrc` file is gitignored and must be regenerated when secrets change.

## Memory Instructions

- Keep memory/ files concise and actionable.
- Each memory file should focus on a single topic.
- Remove outdated entries proactively.
- Never store secrets, API keys, or credentials in memory files.

### Episodic Memory

`memory/episodes.jsonl` stores structured run history as JSON Lines. Each entry:

```json
{"date": "ISO-8601", "workflow": "name", "result": "success|failure", "cost": 0.05, "keyDecisions": ["..."], "tags": ["..."]}
```

Agents can query episodes by workflow, result, or tags to inform decisions. MEMORY.md remains the curated, human-written knowledge base.

### Procedures

`memory/procedures/` contains executable patterns — step-by-step recipes that agents can follow. Unlike skills (which are discovery prompts), procedures are detailed operational sequences.

## Evaluations

`evals/` contains test cases for validating workflow behavior. Each `.json` file defines test cases:

```json
[{"name": "test_name", "workflow": "workflow_name", "input": "prompt", "expectedBehavior": "description", "tags": ["smoke"]}]
```

Run evals with `pilotlynx eval {{PROJECT_NAME}}`. Results are stored in `evals/results/`.
