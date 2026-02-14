# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PilotLynx (`pilotlynx`) is an npm package providing a CLI for local monorepo orchestration of Claude Agent SDK (TypeScript) workflows across multiple isolated projects. The CLI binary is `pilotlynx`, entry point at `dist/cli.js`.

This repo is a **pure npm package** — it contains only the CLI tool and a bundled project template. User workspaces (with `pilotlynx/` config dir and sibling project directories) are created separately via `pilotlynx init`.

## Build & Run

```bash
# Install dependencies
npm install

# Build
npm run build

# Run CLI
npx pilotlynx <command>

# Run tests
npm test
```

The project uses ESM (`"type": "module"` in package.json). TypeScript source compiles to `dist/`.

## Architecture

**CLI = Agent SDK agents.** Every `pilotlynx` CLI command invokes a dedicated Claude Agent SDK agent. The CLI is a thin wrapper — no business logic lives in CLI argument parsing.

### Three Roots

| Concept | Stores | Found via |
|---------|--------|-----------|
| **Package root** | `dist/`, `template/`, `package.json` | `import.meta.url` walk-up |
| **Config root** | `pilotlynx.yaml`, `.env`, `template/`, `shared/` | `getConfigRoot()` — env var or global config file |
| **Global config** | `config.yaml` with `configRoot` pointer | `~/.config/pilotlynx/config.yaml` (OS-appropriate via `env-paths`) |
| **Workspace root** | Project directories (siblings of `pilotlynx/`) | `dirname(getConfigRoot())` |

### Workspace Resolution

1. `PILOTLYNX_ROOT` env var → direct path to the `pilotlynx/` config directory (tests/CI)
2. Global config file → `~/.config/pilotlynx/config.yaml` contains `configRoot` pointing to the `pilotlynx/` directory
3. Error → suggest `pilotlynx init`

The global config file is written by `pilotlynx init` and enables the CLI to work from any directory without filesystem searching.

### Project Registry

Projects are tracked in `pilotlynx/projects.yaml` (name→path mapping). This enables projects at arbitrary filesystem locations, not just workspace root siblings. `listProjects()` reads registry keys; `getProjectDir(name)` resolves the registered path.

### Key Commands

- `pilotlynx init` — create a new workspace with `pilotlynx/` config directory
- `pilotlynx project create <name>` — scaffold from template and register
- `pilotlynx project add <name> --path <dir>` — adopt an existing directory as a project
- `pilotlynx projects list` — enumerate registered projects with paths
- `pilotlynx run <project> <workflow>` — run workflow with secrets injection
- `pilotlynx improve` — trigger self-improvement loop across projects
- `pilotlynx schedule tick` — evaluate and run due scheduled workflows
- `pilotlynx verify <project>` — validate project structure
- `pilotlynx sync template <project>` — apply template updates
- `pilotlynx env <project>` — output policy-filtered secrets (dotenv, --export, --json, --envrc)
- `pilotlynx link <project>` — configure project for direct access (sets PILOTLYNX_ROOT in .claude/settings.json, optional --direnv)
- `pilotlynx unlink <project>` — remove direct-access configuration
- `pilotlynx project add <name> --path <dir>` — adopt an existing directory as a project
- `pilotlynx project remove <name>` — unregister a project
- `pilotlynx status` — show workspace overview (projects, schedules, recent runs)
- `pilotlynx cost [project]` — show cost summary across runs
- `pilotlynx doctor` — check workspace health and prerequisites
- `pilotlynx eval <project>` — run evaluation test cases
- `pilotlynx audit <project>` — view audit log entries
- `pilotlynx logs <project>` — view project run logs
- `pilotlynx logs-prune <project>` — delete old log files
- `pilotlynx relay serve` — start the chat relay service
- `pilotlynx relay stop` — stop the running relay service
- `pilotlynx relay bind <platform> <channel-id> <project>` — bind a channel to a project
- `pilotlynx relay unbind <platform> <channel-id>` — remove a channel binding
- `pilotlynx relay bindings` — list all channel bindings
- `pilotlynx relay doctor` — check relay prerequisites and recommend settings
- `pilotlynx relay add <name> --url <url>` — add a webhook endpoint
- `pilotlynx relay remove <name>` — remove a webhook endpoint
- `pilotlynx relay test` — send a test payload to all webhooks
- `pilotlynx relay status` — show configured webhooks

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

### User Workspace (created by `pilotlynx init`)

```
my-workspace/                  ← workspace root
  pilotlynx/                  ← config root (pilotlynx infrastructure)
    pilotlynx.yaml                — workspace marker
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

## Relay Subsystem

The relay subsystem provides bi-directional chat integration, connecting Slack and Telegram channels to project agents.

### Architecture

```
Service (service.ts) ── orchestrates lifecycle, PID file, health endpoint
  └─ Router (router.ts) ── central dispatch for messages, reactions, commands
       ├─ Context (context.ts) ── assembles conversation context from cache + history
       ├─ Executor (executor.ts) ── runs agent SDK inside project sandbox
       ├─ Queue (queue.ts) ── concurrency-limited agent pool (p-queue)
       ├─ Poster (poster.ts) ── formats and sanitizes agent output
       ├─ Admin (admin.ts) ── handles admin commands (/bind, /unbind, /status)
       ├─ Feedback (feedback.ts) ── classifies reactions, persists feedback
       ├─ Notifier (notifier.ts) ── sends proactive notifications to bound channels
       └─ Platform Adapters
            ├─ Slack (platforms/slack.ts) ── @slack/bolt socket/HTTP mode
            └─ Telegram (platforms/telegram.ts) ── grammy long-polling
```

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/relay/service.ts` | Service lifecycle, PID management, health HTTP endpoint |
| `src/lib/relay/router.ts` | Message routing, rate limiting, run orchestration |
| `src/lib/relay/context.ts` | Conversation context assembly with token budget |
| `src/lib/relay/executor.ts` | Sandboxed agent execution with prompt injection defense |
| `src/lib/relay/db.ts` | SQLite storage (messages, pending, runs, bindings, threads) |
| `src/lib/relay/bindings.ts` | Channel-to-project binding CRUD |
| `src/lib/relay/queue.ts` | Agent pool with per-project concurrency limits |
| `src/lib/relay/poster.ts` | Response formatting, cost footer, output sanitization |
| `src/lib/relay/feedback.ts` | Reaction classification, feedback persistence to memory |
| `src/lib/relay/notify.ts` | Webhook delivery with HMAC signing |
| `src/lib/relay/notifier.ts` | Proactive channel notifications (schedule, improve, alerts) |
| `src/lib/relay/config.ts` | Relay/webhook config loading from YAML |
| `src/lib/relay/types.ts` | Shared types, Zod schemas for relay.yaml |
| `src/lib/relay/platform.ts` | Platform-agnostic ChatPlatform interface |
| `src/commands/relay.ts` | CLI command definitions for relay subcommands |

### Configuration

The relay is configured via `pilotlynx/relay.yaml` in the config root:

- **platforms** — enable/disable Slack and Telegram, set modes and ports
- **agent** — maxConcurrent, timeouts, memory limits, sandbox requirements
- **context** — token budget, max messages per thread, stale thread TTL
- **limits** — per-user rate limits, queue depth, daily budget per project
- **notifications** — schedule failures, improve insights, budget alerts
- **admins** — platform-specific admin user lists

Webhooks are configured separately in `pilotlynx/webhook.yaml`.

### SQLite Tables

The relay uses a SQLite database (`relay.db` in config root) with WAL mode:

- **bindings** — channel-to-project mappings (platform + channel_id primary key)
- **threads** — conversation tracking with message counts and summaries
- **messages** — cached chat messages for context assembly
- **pending_messages** — WAL for incoming messages awaiting processing
- **relay_runs** — run history with cost, tokens, duration, model tracking

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
