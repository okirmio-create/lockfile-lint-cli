# lockfile-lint-cli

Lint and validate `package-lock.json` for security issues and best practices.

## Installation

```bash
npm install -g lockfile-lint-cli
```

## Usage

```bash
# Lint the lockfile in the current directory
lockfile-lint-cli

# Lint a specific lockfile
lockfile-lint-cli -p /path/to/package-lock.json

# Strict mode (exit 1 on warnings too)
lockfile-lint-cli --strict

# JSON output
lockfile-lint-cli --json

# Skip specific checks
lockfile-lint-cli --allow-http --allow-git
```

## Checks

| Rule | Severity | Description |
|------|----------|-------------|
| `no-http` | error | Flags resolved URLs using HTTP instead of HTTPS |
| `no-git-deps` | warning | Flags dependencies resolved from git repositories |
| `registry-only` | warning | Flags resolved URLs pointing to non-registry sources |
| `require-integrity` | error | Ensures all packages have an integrity hash |
| `no-duplicates` | warning | Detects packages installed at multiple versions |
| `lockfile-version` | warning | Warns if lockfileVersion is outdated (v1) |

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --path <path>` | Path to the lockfile | `./package-lock.json` |
| `--strict` | Exit 1 on any warning | `false` |
| `--json` | Output results as JSON | `false` |
| `--allow-http` | Skip HTTP URL check | `false` |
| `--allow-git` | Skip git dependency check | `false` |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All checks passed (or only warnings without `--strict`) |
| `1` | Errors found (or warnings with `--strict`) |
| `2` | Runtime error (file not found, invalid JSON, etc.) |

## License

MIT
