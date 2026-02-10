---
name: plynx-project-add
description: Add an existing directory as a PilotLynx project
argument-hint: <name> --path <dir>
allowed-tools: Bash
---

Adopt an existing directory as a project:

```bash
npx plynx project add $ARGUMENTS
```

Adds missing scaffolding files without overwriting, registers the project, migrates detected secrets from `.env` and `.mcp.json`, then runs an interactive agent to help fill in project docs.
