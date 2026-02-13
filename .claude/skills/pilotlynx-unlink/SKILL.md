---
name: pilotlynx-unlink
description: Remove direct-access configuration from a project
argument-hint: <project>
allowed-tools: Bash
---

Remove direct-access configuration:

```bash
npx pilotlynx unlink $ARGUMENTS
```

Removes PILOTLYNX_ROOT from `.claude/settings.json` and deletes `.envrc` if present.
