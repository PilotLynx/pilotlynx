---
name: plynx-logs
description: View recent workflow run logs for a PilotLynx project
argument-hint: <project> [--last <n>] [--workflow <name>] [--failures]
allowed-tools: Bash
---

View recent workflow logs:

```bash
npx plynx logs $ARGUMENTS
```

Options: `--last <n>` (default 10), `--workflow <name>` to filter, `--failures` for failed runs only.
