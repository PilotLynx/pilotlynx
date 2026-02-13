# Contributing to PilotLynx

Thank you for considering contributing to PilotLynx! This guide will help you get started.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/pilotlynx/pilotlynx.git
cd pilotlynx

# Install dependencies
npm install

# Build
npm run build

# Run the CLI in development mode
npm run dev -- <command>

# Run tests
npm test

# Type check
npm run lint
```

## Project Structure

```
src/              TypeScript source
  cli.ts          CLI entry point (thin wrapper)
  commands/       Command definitions (argument parsing only)
  agents/         Agent configurations (one per CLI command)
  lib/            Core libraries
    command-ops/  Command operation logic
  prompts/        YAML prompt templates
tests/            Unit tests (mirrors src/ structure)
template/         Bundled project scaffold template
dist/             Compiled output (gitignored)
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run a specific test file
npx vitest run tests/unit/registry.test.ts
```

Tests use temporary directories with `PILOTLYNX_ROOT` env var. Each test creates and cleans up its own temp workspace. Follow this pattern for new tests:

```typescript
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'pilotlynx-test-'));
  configDir = join(tmpDir, CONFIG_DIR_NAME);
  process.env.PILOTLYNX_ROOT = configDir;
  resetConfigCache();
  resetRegistryCache();
  // ... set up config files
});

afterEach(() => {
  // restore original env
  rmSync(tmpDir, { recursive: true, force: true });
  resetConfigCache();
  resetRegistryCache();
});
```

## Code Style

- **ESM only** — the project uses `"type": "module"` in package.json
- **TypeScript strict mode** — all code must pass `tsc --noEmit`
- **No business logic in CLI commands** — commands parse arguments and call operation functions
- **Agent configs are pure data** — agent files export config builder functions, not execution logic
- Keep dependencies minimal — justify any new dependency

## Commit Messages

Use short, descriptive commit messages in imperative mood:

```
Add secrets migration for project add workflow
Fix path validation on Windows
Update schedule tick to handle timezone offsets
```

Format: `<verb> <what changed>` — focus on *why*, not *what*. Keep the first line under 72 characters. Add a blank line and body paragraph for complex changes.

## Pull Request Guidelines

1. Fork the repository and create a feature branch from `main`
2. Write tests for new functionality
3. Ensure all tests pass: `npm test`
4. Ensure type checking passes: `npm run lint`
5. Keep commits focused — one logical change per commit
6. Write clear commit messages describing the "why"
7. Open a PR against `main` with a description of what changed and why

## Reporting Bugs

Open a [GitHub issue](https://github.com/pilotlynx/pilotlynx/issues) with:

- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS
- Relevant error output

## Security Issues

See [SECURITY.md](SECURITY.md) for reporting security vulnerabilities.
