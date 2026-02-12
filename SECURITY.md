# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email security concerns to the maintainers via the contact information in the repository
3. Include a description of the vulnerability, steps to reproduce, and any potential impact
4. Allow reasonable time for a fix before public disclosure

We aim to acknowledge reports within 48 hours and provide a fix timeline within 7 days.

## Security Architecture

PilotLynx is designed with defense-in-depth across three layers:

### Secrets Isolation

- Single `.env` file in the config root (`pilotlynx/.env`), never committed to git
- Per-project allowlists in `pilotlynx/shared/policies/secrets-access.yaml`
- Projects only receive secrets explicitly listed in their policy — default is deny-all
- Secrets are injected at runtime via environment variables, never written to files
- Secret values are never logged, printed, or stored in markdown/memory/skills files

### Bash Command Sandboxing

- Multi-layer validation of shell commands executed by agents
- Blocked patterns include destructive operations (`rm -rf /`, `mkfs`, `dd`), network exfiltration (`curl | sh`), and privilege escalation (`sudo`, `chmod 777`)
- Filesystem sandboxing via `bwrap` (Linux) and `sandbox-exec` (macOS) constrains agent file access to the project directory
- Tool access policies are independent from secrets policies (defense-in-depth)

### Project Isolation

- Each project workflow runs inside its own project directory
- Projects cannot read or modify other project files
- The self-improvement loop observes project logs but only the project's own agent modifies project files
- Agent configurations use `canUseTool` callbacks for filesystem boundary enforcement

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Dependencies

Run `npm audit` to check for known vulnerabilities in dependencies. The CI pipeline runs `npm audit --audit-level=moderate` on every push and pull request.
