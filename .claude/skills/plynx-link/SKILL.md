---
name: plynx-link
description: Configure a project for direct access (Claude Code, MCP servers)
argument-hint: <project> [--direnv]
allowed-tools: Bash
---

Link a project for direct access:

```bash
npx plynx link $ARGUMENTS
```

Sets PILOTLYNX_ROOT in `.claude/settings.json`. With `--direnv`, also generates `.envrc` with policy-filtered secrets for MCP server `${VAR}` expansion.
