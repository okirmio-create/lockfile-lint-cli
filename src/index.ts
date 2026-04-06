import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import chalk from "chalk";

interface Issue {
  type: "error" | "warning";
  rule: string;
  message: string;
  package?: string;
}

interface LintResult {
  issues: Issue[];
  passed: number;
  failed: number;
  warnings: number;
}

interface LockfileDependency {
  version?: string;
  resolved?: string;
  integrity?: string;
  dependencies?: Record<string, LockfileDependency>;
}

interface Lockfile {
  lockfileVersion?: number;
  packages?: Record<string, LockfileDependency>;
  dependencies?: Record<string, LockfileDependency>;
}

interface CliOptions {
  path: string;
  strict: boolean;
  json: boolean;
  allowHttp: boolean;
  allowGit: boolean;
}

function loadLockfile(filepath: string): Lockfile {
  const absolute = resolve(filepath);
  const raw = readFileSync(absolute, "utf-8");
  return JSON.parse(raw) as Lockfile;
}

function checkHttpUrls(
  lockfile: Lockfile,
  issues: Issue[],
): void {
  const packages = lockfile.packages ?? {};
  for (const [name, dep] of Object.entries(packages)) {
    if (!dep.resolved) continue;
    if (dep.resolved.startsWith("http://")) {
      issues.push({
        type: "error",
        rule: "no-http",
        message: `HTTP URL detected: ${dep.resolved}`,
        package: name || "(root)",
      });
    }
  }

  const deps = lockfile.dependencies ?? {};
  for (const [name, dep] of Object.entries(deps)) {
    if (!dep.resolved) continue;
    if (dep.resolved.startsWith("http://")) {
      issues.push({
        type: "error",
        rule: "no-http",
        message: `HTTP URL detected: ${dep.resolved}`,
        package: name,
      });
    }
  }
}

function checkGitDeps(
  lockfile: Lockfile,
  issues: Issue[],
): void {
  const packages = lockfile.packages ?? {};
  for (const [name, dep] of Object.entries(packages)) {
    if (!dep.resolved) continue;
    if (
      dep.resolved.startsWith("git+") ||
      dep.resolved.startsWith("git://") ||
      dep.resolved.includes("github.com") && dep.resolved.includes("#")
    ) {
      issues.push({
        type: "warning",
        rule: "no-git-deps",
        message: `Git dependency detected: ${dep.resolved}`,
        package: name || "(root)",
      });
    }
  }

  const deps = lockfile.dependencies ?? {};
  for (const [name, dep] of Object.entries(deps)) {
    const version = dep.version ?? "";
    const resolved = dep.resolved ?? "";
    if (
      version.startsWith("git+") ||
      version.startsWith("git://") ||
      resolved.startsWith("git+") ||
      resolved.startsWith("git://")
    ) {
      issues.push({
        type: "warning",
        rule: "no-git-deps",
        message: `Git dependency detected: ${resolved || version}`,
        package: name,
      });
    }
  }
}

function checkNonRegistryUrls(
  lockfile: Lockfile,
  issues: Issue[],
): void {
  const registryPatterns = [
    "https://registry.npmjs.org/",
    "https://registry.yarnpkg.com/",
  ];

  const packages = lockfile.packages ?? {};
  for (const [name, dep] of Object.entries(packages)) {
    if (!name || !dep.resolved) continue;
    const isRegistry = registryPatterns.some((p) =>
      dep.resolved!.startsWith(p)
    );
    if (!isRegistry && dep.resolved.startsWith("http")) {
      issues.push({
        type: "warning",
        rule: "registry-only",
        message: `Non-registry URL: ${dep.resolved}`,
        package: name,
      });
    }
  }

  const deps = lockfile.dependencies ?? {};
  for (const [name, dep] of Object.entries(deps)) {
    if (!dep.resolved) continue;
    const isRegistry = registryPatterns.some((p) =>
      dep.resolved!.startsWith(p)
    );
    if (!isRegistry && dep.resolved.startsWith("http")) {
      issues.push({
        type: "warning",
        rule: "registry-only",
        message: `Non-registry URL: ${dep.resolved}`,
        package: name,
      });
    }
  }
}

function checkIntegrity(
  lockfile: Lockfile,
  issues: Issue[],
): void {
  const packages = lockfile.packages ?? {};
  for (const [name, dep] of Object.entries(packages)) {
    if (!name) continue;
    if (!dep.integrity && dep.resolved) {
      issues.push({
        type: "error",
        rule: "require-integrity",
        message: "Missing integrity hash",
        package: name,
      });
    }
  }

  const deps = lockfile.dependencies ?? {};
  for (const [name, dep] of Object.entries(deps)) {
    if (!dep.integrity && dep.resolved) {
      issues.push({
        type: "error",
        rule: "require-integrity",
        message: "Missing integrity hash",
        package: name,
      });
    }
  }
}

function checkDuplicates(
  lockfile: Lockfile,
  issues: Issue[],
): void {
  const versionMap = new Map<string, Set<string>>();

  const packages = lockfile.packages ?? {};
  for (const [path, dep] of Object.entries(packages)) {
    if (!path || !dep.version) continue;
    const segments = path.replace(/^node_modules\//, "").split("node_modules/");
    const pkgName = segments[segments.length - 1];
    if (!versionMap.has(pkgName)) {
      versionMap.set(pkgName, new Set());
    }
    versionMap.get(pkgName)!.add(dep.version);
  }

  const deps = lockfile.dependencies ?? {};
  function collectVersions(
    entries: Record<string, LockfileDependency>,
  ): void {
    for (const [name, dep] of Object.entries(entries)) {
      if (!dep.version) continue;
      if (!versionMap.has(name)) {
        versionMap.set(name, new Set());
      }
      versionMap.get(name)!.add(dep.version);
      if (dep.dependencies) {
        collectVersions(dep.dependencies);
      }
    }
  }
  collectVersions(deps);

  for (const [name, versions] of versionMap.entries()) {
    if (versions.size > 1) {
      issues.push({
        type: "warning",
        rule: "no-duplicates",
        message: `Multiple versions: ${[...versions].join(", ")}`,
        package: name,
      });
    }
  }
}

function checkLockfileVersion(
  lockfile: Lockfile,
  issues: Issue[],
): void {
  const version = lockfile.lockfileVersion;
  if (version === undefined) {
    issues.push({
      type: "warning",
      rule: "lockfile-version",
      message: "Missing lockfileVersion field",
    });
  } else if (version === 1) {
    issues.push({
      type: "warning",
      rule: "lockfile-version",
      message:
        "Outdated lockfileVersion 1 detected. Consider upgrading to npm 7+ (lockfileVersion 2/3)",
    });
  }
}

function lint(lockfile: Lockfile, options: CliOptions): LintResult {
  const issues: Issue[] = [];

  if (!options.allowHttp) {
    checkHttpUrls(lockfile, issues);
  }
  if (!options.allowGit) {
    checkGitDeps(lockfile, issues);
  }
  checkNonRegistryUrls(lockfile, issues);
  checkIntegrity(lockfile, issues);
  checkDuplicates(lockfile, issues);
  checkLockfileVersion(lockfile, issues);

  const errors = issues.filter((i) => i.type === "error").length;
  const warnings = issues.filter((i) => i.type === "warning").length;
  const totalChecks = 6;
  const failedChecks =
    new Set(issues.filter((i) => i.type === "error").map((i) => i.rule)).size;

  return {
    issues,
    passed: totalChecks - failedChecks,
    failed: failedChecks,
    warnings,
  };
}

function printResult(result: LintResult, options: CliOptions): void {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const { issues } = result;

  if (issues.length === 0) {
    console.log(chalk.green.bold("\n  All checks passed!\n"));
    return;
  }

  console.log("");

  const grouped = new Map<string, Issue[]>();
  for (const issue of issues) {
    const key = issue.rule;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(issue);
  }

  for (const [rule, ruleIssues] of grouped.entries()) {
    const isError = ruleIssues[0].type === "error";
    const icon = isError ? chalk.red("  FAIL") : chalk.yellow("  WARN");
    console.log(`${icon} ${chalk.bold(rule)}`);
    for (const issue of ruleIssues) {
      const pkg = issue.package ? chalk.dim(` (${issue.package})`) : "";
      console.log(`       ${issue.message}${pkg}`);
    }
    console.log("");
  }

  const passedRules = 6 - new Set(issues.filter((i) => i.type === "error").map((i) => i.rule)).size;
  const errorCount = issues.filter((i) => i.type === "error").length;
  const warnCount = issues.filter((i) => i.type === "warning").length;

  console.log(chalk.bold("  Summary"));
  console.log(`  ${chalk.green(`${passedRules} rules passed`)}`);
  if (errorCount > 0) {
    console.log(`  ${chalk.red(`${errorCount} errors`)}`);
  }
  if (warnCount > 0) {
    console.log(`  ${chalk.yellow(`${warnCount} warnings`)}`);
  }
  console.log(`  ${chalk.dim(`Total issues: ${issues.length}`)}`);
  console.log("");
}

const program = new Command();

program
  .name("lockfile-lint-cli")
  .description(
    "Lint and validate package-lock.json for security issues and best practices",
  )
  .version("1.0.0")
  .option("-p, --path <path>", "path to lockfile", "./package-lock.json")
  .option("--strict", "exit 1 on any warning", false)
  .option("--json", "output results as JSON", false)
  .option("--allow-http", "skip HTTP URL check", false)
  .option("--allow-git", "skip git dependency check", false)
  .action((opts: CliOptions) => {
    try {
      const lockfile = loadLockfile(opts.path);
      const result = lint(lockfile, opts);
      printResult(result, opts);

      if (result.failed > 0) {
        process.exit(1);
      }
      if (opts.strict && result.warnings > 0) {
        process.exit(1);
      }
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        console.error(
          chalk.red(`\n  Error: Lockfile not found at ${opts.path}\n`),
        );
      } else if (err instanceof SyntaxError) {
        console.error(chalk.red(`\n  Error: Invalid JSON in lockfile\n`));
      } else {
        console.error(
          chalk.red(
            `\n  Error: ${err instanceof Error ? err.message : String(err)}\n`,
          ),
        );
      }
      process.exit(2);
    }
  });

program.parse();
