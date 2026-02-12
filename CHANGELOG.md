# Changelog

All notable changes to PilotLynx will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-01-01

### Added

- CLI with `plynx` and `pilotlynx` binaries
- Workspace initialization (`plynx init`) with global config and cron setup
- Project scaffolding from bundled template (`plynx project create`)
- Adopt existing directories as projects (`plynx project add`) with secrets migration
- Project registry with support for relative and absolute paths
- Workflow execution with policy-gated secrets injection (`plynx run`)
- Project structure verification (`plynx verify`)
- Template sync to update projects with latest template changes (`plynx sync template`)
- Secrets environment output in dotenv, export, JSON, and envrc formats (`plynx env`)
- Direct-access configuration with optional direnv integration (`plynx link` / `plynx unlink`)
- Project listing with paths (`plynx projects list`)
- Self-improvement loop with observation and per-project feedback (`plynx improve`)
- Tick-based cron scheduling with catch-up policies (`plynx schedule tick`)
- Schedule status display with last/next run times (`plynx schedule status`)
- Run log viewing with filtering (`plynx logs`)
- Cross-project insights viewing (`plynx insights`)
- Multi-layer bash command sandboxing (pattern blocking + filesystem sandboxing)
- Per-project secrets access policies with deny-all default
- Tool access policies independent from secrets policies
- Filesystem boundary enforcement via `canUseTool` callbacks
- Claude Code skills for all CLI commands
- Auto-improve integration with schedule tick (configurable, once per 24h)
