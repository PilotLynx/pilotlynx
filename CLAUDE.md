# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PilotLynx (`plynx`) is an npm package providing a CLI for local monorepo orchestration of Claude Agent SDK (TypeScript) workflows across multiple isolated projects. The CLI binaries are `plynx` (primary) and `pilotlynx` (alias), entry point at `dist/cli.js`.

This repo is a **pure npm package** — it contains only the CLI tool and a bundled project template. User workspaces (with `pilotlynx/` config dir and sibling project directories) are created separately via `plynx init`.

## Build & Run

```bash
# Install dependencies
npm install

# Build
npm run build

# Run CLI
npx plynx <command>

# Run tests
npm test
```

The project uses ESM (`"type": "module"` in package.json). TypeScript source compiles to `dist/`.

## Architecture

**CLI = Agent SDK agents.** Every `plynx` CLI command invokes a dedicated Claude Agent SDK agent. The CLI is a thin wrapper — no business logic lives in CLI argument parsing.

### Three Roots

| Concept | Stores | Found via |
|---------|--------|-----------|
| **Package root** | `dist/`, `template/`, `package.json` | `import.meta.url` walk-up |
| **Config root** | `plynx.yaml`, `.env`, `template/`, `shared/` | `getConfigRoot()` — env var or global config file |
| **Global config** | `config.yaml` with `configRoot` pointer | `~/.config/pilotlynx/config.yaml` (OS-appropriate via `env-paths`) |
| **Workspace root** | Project directories (siblings of `pilotlynx/`) | `dirname(getConfigRoot())` |

### Workspace Resolution

1. `PILOTLYNX_ROOT` env var → direct path to the `pilotlynx/` config directory (tests/CI)
2. Global config file → `~/.config/pilotlynx/config.yaml` contains `configRoot` pointing to the `pilotlynx/` directory
3. Error → suggest `plynx init`

The global config file is written by `plynx init` and enables the CLI to work from any directory without filesystem searching.

### Project Registry

Projects are tracked in `pilotlynx/projects.yaml` (name→path mapping). This enables projects at arbitrary filesystem locations, not just workspace root siblings. `listProjects()` reads registry keys; `getProjectDir(name)` resolves the registered path.

### Key Commands

- `plynx init` — create a new workspace with `pilotlynx/` config directory
- `plynx project create <name>` — scaffold from template and register
- `plynx project add <name> --path <dir>` — adopt an existing directory as a project
- `plynx projects list` — enumerate registered projects with paths
- `plynx run <project> <workflow>` — run workflow with secrets injection
- `plynx improve` — trigger self-improvement loop across projects
- `plynx schedule tick` — evaluate and run due scheduled workflows
- `plynx verify <project>` — validate project structure
- `plynx sync template <project>` — apply template updates
- `plynx env <project>` — output policy-filtered secrets (dotenv, --export, --json, --envrc)
- `plynx link <project>` — configure project for direct access (sets PILOTLYNX_ROOT in .claude/settings.json, optional --direnv)
- `plynx unlink <project>` — remove direct-access configuration

### Repository Layout (npm package)

```
/src/                    — CLI TypeScript source
/tests/                  — unit and integration tests
/template/               — bundled project template (ships in npm package)
/package.json
/tsconfig.json
/vitest.config.ts
/LICENSE
```

### User Workspace (created by `plynx init`)

```
my-workspace/                  ← workspace root
  pilotlynx/                  ← config root (plynx infrastructure)
    plynx.yaml                — workspace marker
    projects.yaml             — project registry (name→path mapping)
    .env                      — secrets (never committed)
    .gitignore
    template/                 — project scaffold template
    shared/
      policies/               — secrets access policy, tool allowlists
      docs/                   — shared documentation
      insights/               — cross-project learnings
  project-a/                  ← same level as pilotlynx/
  project-b/                  ← each can be its own git repo
```

### Project Skeleton (every project follows this)

```
<name>/
  CLAUDE.md               — project-specific operating rules
  PROJECT_BRIEF.md        — key decisions and goals (project marker)
  RUNBOOK.md              — operational procedures
  .mcp.json               — project-scoped MCP servers
  .claude/skills/         — project skills
  workflows/              — TypeScript Agent SDK workflows
  memory/                 — durable curated memory (committed)
  artifacts/              — output artifacts (gitignored)
  logs/                   — run logs (gitignored)
```

## Critical Design Rules

1. **Project isolation** — projects cannot read/modify other project files. Workflows run inside their project folder only.

2. **Single `.env` in config root** — never committed. Lives at `pilotlynx/.env`. Secrets are injected at runtime via allowlist policy (`pilotlynx/shared/policies/`). Projects never store secrets locally.

3. **Secrets safety** — never print secrets to logs, never put raw secrets in markdown/skills/memory files, treat secrets as runtime-only.

4. **Bounded workflows** — single runs with clear start/end, no long-lived agent sessions. Failed workflows support deterministic rerun.

5. **Durable memory is files** — all project knowledge lives in committed files (brief, runbook, skills, memory). No dependence on session state.

6. **No hidden defaults** — all behavior configured in committed files. Configuration must be discoverable by reading the repo.

7. **Lynx never writes project files** — the self-improvement loop triggers project agents via workflow invocation; only the project's own agent modifies its files.

## Testing

Tests use `PILOTLYNX_ROOT` env var pointing at the `pilotlynx/` config directory inside temp workspace directories. All tests create and clean up their own temp dirs. Pattern: `PILOTLYNX_ROOT = join(tmpDir, 'pilotlynx')`, projects at `tmpDir/<name>`.

Tests that use `getProjectDir()` or functions that depend on it must register projects in the registry first. Pattern: call `resetRegistryCache()` in `beforeEach`/`afterEach`, and `registerProject(name, path)` before accessing project paths.
