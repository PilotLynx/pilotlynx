---
name: plynx-env
description: Output policy-filtered environment variables for a project
argument-hint: <project> [--export|--json|--envrc]
allowed-tools: Bash
---

Output policy-filtered secrets for a project:

```bash
npx plynx env $ARGUMENTS
```

Formats: default (dotenv), `--export` (eval-able), `--json`, `--envrc` (includes PILOTLYNX_ROOT). Only secrets permitted by the project's policy are included.
