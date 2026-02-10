# PilotLynx
PilotLynx is a CLI for orchestrating Claude Agent SDK workflows across isolated projects.

PilotLynx gives you a single `plynx` command that manages project scaffolding, secret injection, workflow execution, scheduling, and cross-project self-improvement — all from your terminal.

## Why PilotLynx

**One CLI, many projects.** Each project gets its own folder, its own config, its own workflows. Projects cannot touch each other's files.

**Projects anywhere.** Projects are tracked in a registry, not discovered by convention. Add projects at any filesystem location — workspace siblings, external repos, monorepo subdirectories.

**Secrets stay safe.** One `.env` file at the workspace root. Each project declares which secrets it needs in a policy file. Secrets are injected at runtime and never written to logs, markdown, or memory files.

**Workflows are bounded.** Every run has a clear start and end. No long-lived sessions. Failed runs can be rerun deterministically.

**All state is files.** Project briefs, runbooks, skills, and memory are committed files in git. Nothing depends on session state or external databases.

**Self-improvement built in.** `plynx improve` runs a review loop across all projects, generating cross-project insights and applying template updates.

**Scoped context** — workflows see only what they need. Project-scoped, curated memory by default.

**Auditable tooling** — no external plugins. All skills are local, committed, and code-reviewable. Tool access is policy-gated.

## Architecture: CLI = Agent SDK

The CLI is a thin wrapper around Claude Agent SDK agents. Every `plynx` command invokes a dedicated agent, making the CLI a convenience layer rather than the primary execution surface.

- **Each command = one agent.** `plynx project create foo` runs a "project-create" agent that scaffolds the directory from the template.
- **Most CLI commands have corresponding Claude Code skills** for use inside projects.
- **Business logic lives in agents.** Exception: `plynx init` scaffolds the workspace directly since no workspace exists yet for agent context.

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

## Quick Start

### 1. Create a workspace

```bash
mkdir my-agents && cd my-agents
plynx init --name my-agents
```

This creates:

```
my-agents/
  pilotlynx/              # config directory
    plynx.yaml            # workspace marker
    projects.yaml         # project registry (name → path)
    template/             # project scaffold template
    shared/policies/      # secrets + tool access policies
    shared/docs/          # shared documentation
    shared/insights/      # cross-project learnings
    .gitignore
```

It also writes a global config at `~/.config/pilotlynx/config.yaml` (Linux) so the CLI works from any directory.

### 2. Create or add a project

```bash
# Create a new project from template
plynx project create myproject

# Or adopt an existing directory (at any path)
plynx project add myrepo --path /path/to/existing/repo
```

`create` scaffolds from the template into `myproject/` (at the workspace root) with:
- `CLAUDE.md` — project rules
- `PROJECT_BRIEF.md` — goals and decisions
- `RUNBOOK.md` — operational procedures
- `workflows/` — TypeScript Agent SDK workflow files
- `memory/` — durable knowledge (committed to git)

`add` adopts an existing directory: adds missing scaffolding files without overwriting anything, registers the project, then runs an interactive agent that examines the existing code and helps fill in project docs.

Both commands register the project in `pilotlynx/projects.yaml` and prompt for secrets access configuration.

### 3. Run a workflow

```bash
plynx run myproject daily_feedback
```

Loads secrets from `.env` per the project's allowlist, then executes the workflow.

### 4. Check project structure

```bash
plynx verify myproject
```

Reports missing files or directories.

## Commands

| Command | What it does |
|---------|-------------|
| `plynx init` | Create a new workspace |
| `plynx project create <name>` | Scaffold a project from template |
| `plynx project add <name> --path <dir>` | Add an existing directory as a project |
| `plynx projects list` | List all projects with paths |
| `plynx run <project> <workflow>` | Run a workflow with secrets injection |
| `plynx verify <project>` | Validate project structure |
| `plynx improve` | Run self-improvement loop across projects |
| `plynx schedule tick` | Run due scheduled workflows |
| `plynx sync template <project>` | Apply template updates to a project |
| `plynx env <project>` | Output policy-filtered secrets (`--export`, `--json`, `--envrc`) |
| `plynx link <project>` | Configure a project for direct access (`--direnv` for `.envrc`) |
| `plynx unlink <project>` | Remove direct-access configuration |

## Working Directly in a Project

PilotLynx stores its config location in a global file (`~/.config/pilotlynx/config.yaml` on Linux, OS-appropriate on macOS/Windows) so the CLI works from any directory — no need to be inside the workspace.

For MCP servers that need secrets via `${VAR}` expansion, use [direnv](https://direnv.net/):

```bash
plynx link myproject --direnv   # generates .envrc with policy-filtered secrets
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

## Secrets

Create a `.env` file inside the `pilotlynx/` config directory:

```
ANTHROPIC_API_KEY=sk-...   # only needed for API key auth; omit if using claude login
GITHUB_TOKEN=ghp_...
```

Define which projects can access which secrets in `pilotlynx/shared/policies/secrets-access.yaml`.

### Injection Rule

When running a project workflow, PilotLynx builds the runtime environment as:

1. Load secrets from `pilotlynx/.env`.
2. Select only the variables permitted for the target project (allowlist, plus project-specific mappings from policy).
3. Launch the workflow with only the permitted variables available.

A project receives only the variables it is allowed to see. Multiple keys for the same tool are supported by policy-controlled mapping, without duplicating secrets files.

Secrets are injected at runtime only — they never appear in logs or committed files.

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

## Scheduling

Each project can define a `schedule.yaml` to run workflows on a cron schedule:

```yaml
schedules:
  - workflow: daily_feedback
    cron: "0 9 * * *"          # standard cron syntax
    timezone: America/New_York # IANA timezone
    catchUpPolicy: run_latest  # what to do about missed runs
```

### How it works

PilotLynx uses **tick-based scheduling** — there is no long-running daemon. You run `plynx schedule tick` periodically (via system cron, systemd timer, or any scheduler) and it evaluates which workflows are due.

Each tick:
1. Reads every project's `schedule.yaml`.
2. Compares the cron expression against the last recorded run time.
3. Applies the catch-up policy to any missed runs.
4. Executes the due workflows and records the new last-run time.

### Catch-up policies

When runs are missed (machine was off, tick didn't fire), the policy controls what happens:

| Policy | Behavior |
|--------|----------|
| `run_latest` | Run only the most recent missed occurrence (default) |
| `run_all` | Run every missed occurrence in order |
| `skip` | Discard all missed runs, wait for the next future occurrence |

Missed runs older than **7 days** are always discarded regardless of policy.

### Automation examples

**System cron** (run tick every 15 minutes):

```
*/15 * * * * plynx schedule tick >> /var/log/plynx-tick.log 2>&1
```

**systemd timer** — create `plynx-tick.service` and `plynx-tick.timer` units that call `plynx schedule tick` on your preferred interval.

## Self-Improvement Loop

`plynx improve` triggers a two-phase cycle:

**Observation (Lynx-owned):** Reads conversation logs, user feedback, and run outcomes across all projects. Distills per-project summaries and produces abstract cross-project insights (stored in `pilotlynx/shared/insights/`).

**Improvement (Project-owned, Lynx-triggered):** Invokes each project's `daily_feedback` workflow with the distilled summary. The project's own agent decides what to update — brief, runbook, skills, or memory. Lynx never writes to project files directly.

## Claude Code Compatibility

- The workspace can be opened directly in Claude Code.
- `plynx` works from the workspace root, from project directories (via global config), and from any other location.
- `plynx link --direnv` generates `.envrc` for MCP servers that need secrets via `${VAR}` expansion.
- Each CLI command maps to a Claude Code skill — same agent, same behavior.

## Security Model

- Project workflows operate inside their project folder and must not access other project directories.
- Secrets are injected via env and never stored in committed files.
- No external skills marketplace — all skills are local and committed.
- Tool access is policy-gated — secrets allowlists and tool allowlists are independent controls (defense-in-depth).

## License

MIT
