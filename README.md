# PilotLynx

[![npm version](https://img.shields.io/npm/v/pilotlynx.svg)](https://www.npmjs.com/package/pilotlynx)
[![CI](https://github.com/pilotlynx/pilotlynx/actions/workflows/ci.yml/badge.svg)](https://github.com/pilotlynx/pilotlynx/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)

Local monorepo orchestration for Claude Agent SDK workflows. One CLI to manage project scaffolding, policy-gated secrets, cron scheduling, and cross-project self-improvement.

## What Makes PilotLynx Different

Three features that don't exist in other AI workflow tools:

### Cron Ping

Define cron schedules per project. PilotLynx uses tick-based scheduling — no daemon, no background process. You run `pilotlynx schedule tick` from a system cron entry and it figures out what's due.

**`schedule.yaml`** (in each project):

```yaml
schedules:
  - workflow: daily_feedback
    cron: "0 9 * * *"
    timezone: America/New_York
    catchUpPolicy: run_latest
```

**How a tick works:**

1. Read every project's `schedule.yaml`
2. Compare cron expressions against last recorded run times
3. Apply the catch-up policy to any missed runs
4. Execute due workflows and record the new last-run time

**Catch-up policies** (when the machine was off or tick didn't fire):

| Policy | Behavior |
|--------|----------|
| `run_latest` | Run only the most recent missed occurrence (default) |
| `run_all` | Run every missed occurrence in order |
| `skip` | Discard all missed runs, wait for the next future occurrence |

Missed runs older than **7 days** are always discarded regardless of policy.

`pilotlynx init` auto-installs a system cron entry (`*/15 * * * *`) so scheduling works out of the box. Each tick also runs the self-improvement loop automatically (once per 24h, configurable).

```bash
pilotlynx schedule status myproject   # see what's scheduled, last/next runs
```

### Self-Improvement Loop

`pilotlynx improve` triggers a two-phase cycle that makes projects learn from their own run history:

**Phase 1 — Observation (Lynx-owned, read-only):** Reads conversation logs, user feedback, and run outcomes across all projects. Produces per-project summaries and cross-project insights (stored in `pilotlynx/shared/insights/`).

**Phase 2 — Improvement (project-owned, Lynx-triggered):** Invokes each project's `daily_feedback` workflow with the distilled summary. The project's own agent decides what to update — brief, runbook, skills, or memory.

Key design constraint: **Lynx never writes project files.** The orchestrator observes and triggers; only the project's own agent modifies its files.

Auto-runs via `schedule tick` once per 24h. Manual trigger anytime with `pilotlynx improve`. Toggle in `pilotlynx.yaml`:

```yaml
autoImprove:
  enabled: false   # default: true
```

```bash
pilotlynx insights                    # view cross-project insights
pilotlynx insights --since 2025-01-10 # filter by date
```

### Shared Env

One `.env` file, per-project allowlists. A project sees only the secrets its policy permits — injected at runtime, never written to files.

**`pilotlynx/shared/policies/secrets-access.yaml`:**

```yaml
version: 1
shared:
  - ANTHROPIC_API_KEY         # every project gets this

projects:
  my-web-app:
    allowed:
      - GITHUB_TOKEN
      - DATABASE_URL
    mappings:
      SLACK_URL: SLACK_WEBHOOK  # project sees SLACK_URL, sourced from .env's SLACK_WEBHOOK

  my-cli-tool:
    allowed:
      - GITHUB_TOKEN
```

**Inspect and export:**

```bash
pilotlynx env myproject              # dotenv format
pilotlynx env myproject --export     # export KEY=value (eval-able)
pilotlynx env myproject --json       # {"KEY": "value"}
pilotlynx link myproject --direnv    # generate .envrc for MCP server ${VAR} expansion
```

**Auto-migration:** When you adopt an existing project with `pilotlynx project add`, PilotLynx detects secrets in the project's `.env` and `.mcp.json` literals, consolidates them into the central store, and updates the policy — no manual copy-paste.

**Default is deny-all.** No policy file = zero secrets injected. See [`docs/secrets-and-mcp.md`](docs/secrets-and-mcp.md) for the full guide.

## Why PilotLynx

PilotLynx occupies a specific niche: **workspace-level orchestration of isolated Claude Agent SDK projects**. No single existing tool covers this combination. Here's how it compares:

| Tool | What it solves | What PilotLynx adds |
|------|---------------|---------------------|
| [Claude Agent SDK](https://docs.anthropic.com/en/docs/agents) | Build individual AI agents in TypeScript | Multi-project orchestration, scaffolding, shared secrets, scheduling |
| [OpenClaw](https://github.com/openclaw/openclaw) | General-purpose personal AI assistant (email, calendar, web) with 20+ messaging integrations | Developer-focused CLI for code projects, policy-gated secrets, template-based scaffolding, cross-project self-improvement |
| [CrewAI](https://github.com/crewAIInc/crewAI) | Multi-agent collaboration with role-based agents (Python) | File-based durable state in git, project isolation, TypeScript-native with Agent SDK |
| [LangGraph](https://github.com/langchain-ai/langgraph) | Stateful multi-step agent graphs | Workspace-level concerns: secrets policy, cron scheduling, cross-project insights |
| [Turborepo](https://turbo.build/repo) | Monorepo build orchestration and caching | AI workflow orchestration, not build — schedules agents, injects secrets, tracks run logs |
| [AgentStack](https://github.com/AgentOps-AI/AgentStack) | Scaffolding for CrewAI/LangGraph projects | Claude Agent SDK native, multi-project workspace, self-improvement loop |
| [Infisical](https://infisical.com/) | Secrets management platform | Lightweight file-based secrets with per-project allowlists, no external service |

**What PilotLynx uniquely combines:**
- CLI-first developer workflow (not conversation-first, not GUI-first)
- Claude Agent SDK native — every CLI command is an agent
- Multi-project isolation with shared infrastructure (secrets, policies, insights)
- Tick-based cron scheduling with catch-up policies
- Cross-project self-improvement loop
- All state in committed files — no database, no external service

## Requirements

- **Node.js** 20 or later
- **Authentication** (one of the following):
  - **Anthropic API key** — set `ANTHROPIC_API_KEY` in `pilotlynx/.env`
  - **Claude Code subscription** (Pro / Max / Teams) — run `claude login` once. No API key needed; the Agent SDK reads OAuth tokens from `~/.claude/` automatically.
- **Claude Code** (optional) — PilotLynx works standalone, but each CLI command also maps to a Claude Code skill for in-editor use

## Install

```bash
npm install -g pilotlynx
```

> **Permission denied?** If you see `EACCES` errors, either prefix with `sudo` or (recommended) use a Node version manager like [nvm](https://github.com/nvm-sh/nvm) / [fnm](https://github.com/Schniz/fnm) which installs to user-owned directories. You can also run without installing globally:
>
> ```bash
> npx pilotlynx <command>
> ```

## Quick Start

### 1. Create a workspace

```bash
mkdir my-agents && cd my-agents
pilotlynx init --name my-agents
```

This creates:

```
my-agents/
  pilotlynx/              # config directory
    pilotlynx.yaml            # workspace marker
    projects.yaml         # project registry (name → path)
    template/             # project scaffold template
    shared/policies/      # secrets + tool access policies
    shared/docs/          # shared documentation
    shared/insights/      # cross-project learnings
    .gitignore
```

It also writes a global config at `~/.config/pilotlynx/config.yaml` (Linux) so the CLI works from any directory, and installs a cron entry for `pilotlynx schedule tick` every 15 minutes.

### 2. Create or add a project

```bash
# Create a new project from template
pilotlynx project create myproject

# Or adopt an existing directory (at any path)
pilotlynx project add myrepo --path /path/to/existing/repo
```

`create` scaffolds from the template into `myproject/` (at the workspace root) with:
- `CLAUDE.md` — project rules
- `PROJECT_BRIEF.md` — goals and decisions
- `RUNBOOK.md` — operational procedures
- `workflows/` — TypeScript Agent SDK workflow files
- `memory/` — durable knowledge (committed to git)

`add` adopts an existing directory: adds missing scaffolding files without overwriting anything, registers the project, migrates detected secrets into the central store, then runs an interactive agent that examines the existing code and helps fill in project docs.

Both commands register the project in `pilotlynx/projects.yaml` and prompt for secrets access configuration.

### 3. Run a workflow

```bash
pilotlynx run myproject daily_feedback
```

Loads secrets from `.env` per the project's allowlist, then executes the workflow.

### 4. Check project structure

```bash
pilotlynx verify myproject
```

Reports missing files or directories.

## Commands

| Command | What it does |
|---------|-------------|
| `pilotlynx init` | Create a new workspace |
| `pilotlynx project create <name>` | Scaffold a project from template |
| `pilotlynx project add <name> --path <dir>` | Add an existing directory as a project |
| `pilotlynx projects list` | List all projects with paths |
| `pilotlynx run <project> <workflow>` | Run a workflow with secrets injection |
| `pilotlynx verify <project>` | Validate project structure |
| `pilotlynx improve` | Run self-improvement loop across projects |
| `pilotlynx schedule tick` | Run due scheduled workflows |
| `pilotlynx schedule status <project>` | Show schedules, last/next run times, auto-improve state |
| `pilotlynx logs <project>` | View recent run logs (`--last`, `--workflow`, `--failures`) |
| `pilotlynx insights` | View cross-project insights (`--last`, `--since`) |
| `pilotlynx sync template <project>` | Apply template updates to a project |
| `pilotlynx env <project>` | Output policy-filtered secrets (`--export`, `--json`, `--envrc`) |
| `pilotlynx link <project>` | Configure a project for direct access (`--direnv` for `.envrc`) |
| `pilotlynx unlink <project>` | Remove direct-access configuration |

## Other Features

- Every CLI command is a Claude Agent SDK agent — the CLI is a thin wrapper with no business logic
- Bounded workflows with clear start/end — no long-lived sessions, failed runs rerun deterministically
- All state is committed files — briefs, runbooks, skills, memory in git, zero dependence on session state
- Scoped context — workflows see only their project directory plus shared docs/insights
- No external plugins — all skills are local, committed, and code-reviewable
- Tool access policies independent from secrets policies (defense-in-depth)
- Filesystem sandboxing via bwrap (Linux) and sandbox-exec (macOS)

## Architecture: CLI = Agent SDK

The CLI is a thin wrapper around Claude Agent SDK agents. Every `pilotlynx` command invokes a dedicated agent, making the CLI a convenience layer rather than the primary execution surface.

- **Each command = one agent.** `pilotlynx project create foo` runs a "project-create" agent that scaffolds the directory from the template.
- **Most CLI commands have corresponding Claude Code skills** for use inside projects.
- **Business logic lives in agents.** Exception: `pilotlynx init` scaffolds the workspace directly since no workspace exists yet for agent context.

## Working Directly in a Project

PilotLynx stores its config location in a global file (`~/.config/pilotlynx/config.yaml` on Linux, OS-appropriate on macOS/Windows) so the CLI works from any directory — no need to be inside the workspace.

For MCP servers that need secrets via `${VAR}` expansion, use [direnv](https://direnv.net/):

```bash
pilotlynx link myproject --direnv   # generates .envrc with policy-filtered secrets
cd myproject && direnv allow     # activate
```

The `.envrc` is gitignored. Regenerate it when secrets change.

## Project Registry

Projects are tracked in `pilotlynx/projects.yaml`:

```yaml
version: 1
projects:
  my-app:
    path: my-app                          # relative to workspace root
  external-repo:
    path: /home/user/repos/external-repo  # absolute path
```

Paths under the workspace root are stored as relative; paths outside are stored as absolute. This keeps the registry portable — move the workspace and relative paths still resolve.

## Project Structure

Every project follows the same layout:

```
myproject/
  CLAUDE.md               # project-specific agent rules
  PROJECT_BRIEF.md        # goals, decisions, constraints
  RUNBOOK.md              # how to operate this project
  .mcp.json               # MCP server config
  .claude/settings.json   # shared project permissions
  .claude/skills/         # project-scoped skills
  .claude/rules/          # modular topic-specific rules
  workflows/              # TypeScript Agent SDK workflows
  memory/MEMORY.md        # durable knowledge entrypoint (git-tracked)
  artifacts/              # output files (gitignored)
  logs/                   # run logs (gitignored)
  schedule.yaml           # cron schedules for workflows
```

## Workflows

Each project has workflows under `workflows/` — TypeScript scripts that run Claude Agent SDK.

### Execution Model

- Bounded, isolated runs with a clear start and end.
- Each run produces a logged outcome: success or failure, plus a short summary.
- Failed workflows support deterministic rerun with the same inputs.
- Retries are bounded and explicit — no infinite retry loops.

### Standard Workflows

Each project should support these baseline workflows:

| Workflow | Purpose |
|----------|---------|
| `daily_feedback` | Review recent activity and update project memory |
| `task_execute` | Execute a specific task from prompt input |
| `project_review` | Produce a short project status update |

## Security Model

- Project workflows operate inside their project folder and must not access other project directories.
- Secrets are injected via env and never stored in committed files.
- No external skills marketplace — all skills are local and committed.
- Tool access is policy-gated — secrets allowlists and tool allowlists are independent controls (defense-in-depth).

## Claude Code Compatibility

- The workspace can be opened directly in Claude Code.
- `pilotlynx` works from the workspace root, from project directories (via global config), and from any other location.
- `pilotlynx link --direnv` generates `.envrc` for MCP servers that need secrets via `${VAR}` expansion.
- Each CLI command maps to a Claude Code skill — same agent, same behavior.

## Design Decisions

**Minimal dependencies (11 total).** Each dependency earns its place: `commander` for CLI parsing, `chalk` for terminal colors, `cli-table3` for table output, `croner` for cron parsing, `yaml`/`zod` for config, `dotenv` for secrets loading, `env-paths` for OS-appropriate config paths, `proper-lockfile` for concurrent tick safety, `grammy` for Telegram relay, and `@anthropic-ai/claude-agent-sdk` for the core runtime. No ORMs, no template engines, no framework overhead.

**File-based state over databases.** All state — project briefs, runbooks, skills, memory, run logs, schedule state — lives in committed files. This makes workspaces portable, git-friendly, and inspectable with standard tools. No database to provision or migrate.

**Simple template interpolation over template engines.** Project scaffolding uses direct file copying with string replacement rather than Handlebars/EJS/etc. This avoids a class of injection vulnerabilities and keeps templates readable as plain files.

## License

MIT
