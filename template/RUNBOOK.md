# {{PROJECT_NAME}} — Runbook

## Quick Start

1. Ensure PilotLynx is built: `npm run build` from repo root
2. Run a workflow: `npx pilotlynx run {{PROJECT_NAME}} <workflow>`
3. Check project status: `npx pilotlynx verify {{PROJECT_NAME}}`

## Workflows

### daily_feedback

Reviews recent project activity and updates memory files.

```bash
npx pilotlynx run {{PROJECT_NAME}} daily_feedback
```

### task_execute

Executes a specific task. Provide task details as input.

```bash
npx pilotlynx run {{PROJECT_NAME}} task_execute
```

### project_review

Produces a short project status update.

```bash
npx pilotlynx run {{PROJECT_NAME}} project_review
```

## Troubleshooting

- **Build fails**: Run `npm run build` in the PilotLynx package directory and check for TypeScript errors.
- **Missing secrets**: Verify `.env` inside `pilotlynx/` has required keys and `pilotlynx/shared/policies/secrets-access.yaml` allows them.
- **Workflow timeout**: Check workflow complexity and consider breaking into smaller steps.

## Maintenance

- Review and prune memory/ files monthly.
- Update PROJECT_BRIEF.md when goals or decisions change.
- Keep skills/ current with actual usage patterns.
