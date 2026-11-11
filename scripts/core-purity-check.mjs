import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const FORBIDDEN_EXACT_PACKAGES = new Set([
  "react",
  "react-dom",
  "react-router-dom",
  "zustand",
  "i18next",
  "react-i18next",
  "fs",
  "path",
  "os",
  "child_process",
  "crypto",
  "http",
  "https",
  "net",
  "tls",
  "url",
  "util",
  "stream",
  "events",
  "zlib",
  "worker_threads",
  "bun",
]);

const FORBIDDEN_PACKAGE_PREFIXES = [
  "react/",
  "react-dom/",
  "react-router-dom/",
  "zustand/",
  "i18next/",
  "react-i18next/",
  "@tauri-apps/",
  "node:",
  "bun:",
  "fs/",
  "path/",
];

const FORBIDDEN_GLOBALS = new Set([
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "navigator",
  "HTMLElement",
  "Blob",
  "FileReader",
  "alert",
  "confirm",
]);

const FORBIDDEN_WORKSPACE_DIRS = [
  "src/store",
  "src/components",
  "src/pages",
  "src/utils",
  "mcp",
  "src-tauri",
];

function collectEntryFiles(dirPath) {
  const results = [];
  if (!fs.existsSync(dirPath)) return results;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectEntryFiles(fullPath));
    } else if (
      entry.isFile() &&
      /\.(ts|mts|cts|js|mjs|cjs)$/.test(entry.name) &&
      !/\.test\.(ts|mts|cts|js|mjs|cjs)$/.test(entry.name)
    ) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function resolveRelativeImport(fromFile, specifier) {
  const baseDir = path.dirname(fromFile);
  const rawTarget = path.resolve(baseDir, specifier);

  const candidates = [rawTarget];

  if (/\.(js|mjs|cjs)$/.test(rawTarget)) {
    const stem = rawTarget.replace(/\.(js|mjs|cjs)$/, "");
    candidates.unshift(`${stem}.ts`, `${stem}.d.ts`);
  } else if (!/\.[a-z0-9]+$/i.test(path.basename(rawTarget))) {
    candidates.push(
      `${rawTarget}.ts`,
      `${rawTarget}.d.ts`,
      `${rawTarget}.js`,
      `${rawTarget}.mjs`,
      path.join(rawTarget, "index.ts"),
      path.join(rawTarget, "index.d.ts"),
      path.join(rawTarget, "index.js"),
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return fs.realpathSync(candidate);
    }
  }
  return null;
}

function isForbiddenSpecifier(specifier) {
  if (FORBIDDEN_EXACT_PACKAGES.has(specifier)) {
    return `Forbidden package import "${specifier}"`;
  }
  for (const prefix of FORBIDDEN_PACKAGE_PREFIXES) {
    if (specifier.startsWith(prefix)) {
      return `Forbidden package import "${specifier}"`;
    }
  }
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    return `External package import "${specifier}" is not allowed in pure core`;
  }
  return null;
}

function formatLoc(sourceFile, node) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return `${line + 1}:${character + 1}`;
}

function isNonGlobalMemberName(node) {
  const parent = node.parent;
  if (!parent) return false;

  if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
    const expr = parent.expression;
    if (
      ts.isIdentifier(expr) &&
      (expr.text === "globalThis" || expr.text === "self")
    ) {
      return false;
    }
    return true;
  }

  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent)) &&
    parent.name === node
  ) {
    return true;
  }

  return false;
}

function inspectSourceAst(sourceFile, relFilePath) {
  const specs = [];
  const astViolations = [];

  const visit = (node) => {
    // 1. Static import declarations: `import ... from "x"` or `import "x"`
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specs.push({
        specifier: node.moduleSpecifier.text,
        loc: formatLoc(sourceFile, node.moduleSpecifier),
      });
    }

    // 2. Re-exports: `export ... from "x"` or `export * from "x"`
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specs.push({
        specifier: node.moduleSpecifier.text,
        loc: formatLoc(sourceFile, node.moduleSpecifier),
      });
    }

    // 3. TypeScript import types: `type X = import("x").Y`
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      specs.push({
        specifier: node.argument.literal.text,
        loc: formatLoc(sourceFile, node.argument),
      });
    }

    // 4. Dynamic `import(...)` and `require(...)`
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteralLike(arg)) {
          specs.push({
            specifier: arg.text,
            loc: formatLoc(sourceFile, arg),
          });
        } else {
          astViolations.push(
            `${relFilePath}:${formatLoc(sourceFile, node)} — Non-literal dynamic import() is forbidden in core`,
          );
        }
      } else if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require"
      ) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteralLike(arg)) {
          specs.push({
            specifier: arg.text,
            loc: formatLoc(sourceFile, arg),
          });
        } else {
          astViolations.push(
            `${relFilePath}:${formatLoc(sourceFile, node)} — require() is forbidden in core`,
          );
        }
      }
    }

    // 5. Forbidden `console.log` (`console.warn` / `console.error` are permitted)
    if (ts.isPropertyAccessExpression(node) && node.name.text === "log") {
      const expr = node.expression;
      const isConsole =
        (ts.isIdentifier(expr) && expr.text === "console") ||
        (ts.isPropertyAccessExpression(expr) &&
          ts.isIdentifier(expr.expression) &&
          expr.expression.text === "globalThis" &&
          expr.name.text === "console");
      if (isConsole) {
        astViolations.push(
          `${relFilePath}:${formatLoc(sourceFile, node)} — Forbidden global "console.log" (use console.warn or console.error if needed)`,
        );
      }
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "console" &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "log"
    ) {
      astViolations.push(
        `${relFilePath}:${formatLoc(sourceFile, node)} — Forbidden global "console.log"`,
      );
    }

    // 6. Forbidden browser / DOM globals (outside comments & string literals)
    if (ts.isIdentifier(node) && FORBIDDEN_GLOBALS.has(node.text)) {
      if (!isNonGlobalMemberName(node)) {
        astViolations.push(
          `${relFilePath}:${formatLoc(sourceFile, node)} — Forbidden browser/DOM global "${node.text}"`,
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { specs, astViolations };
}

/**
 * Walks the full transitive dependency graph from `coreDir` and checks purity rules.
 *
 * @param {object} [options]
 * @param {string} [options.projectRoot]
 * @param {string} [options.coreDir]
 * @param {string[]} [options.allowedDirs] - Directories (relative to projectRoot) allowed in transitive closure
 * @returns {{ ok: boolean; checkedFiles: string[]; violations: string[] }}
 */
export function checkCorePurity(options = {}) {
  const projectRoot = fs.realpathSync(options.projectRoot ?? process.cwd());
  const coreDir = options.coreDir
    ? path.resolve(projectRoot, options.coreDir)
    : path.join(projectRoot, "src/core");
  const allowedRelDirs = options.allowedDirs ?? [
    "src/core",
    "src/types",
    "src/data",
  ];
  const allowedAbsDirs = allowedRelDirs.map((d) =>
    path.resolve(projectRoot, d),
  );
  const forbiddenAbsDirs = FORBIDDEN_WORKSPACE_DIRS.map((d) => ({
    label: d,
    abs: path.resolve(projectRoot, d),
  }));

  const entryFiles = collectEntryFiles(coreDir).map((f) => fs.realpathSync(f));
  const queue = entryFiles.map((f) => ({ file: f, chain: [f] }));
  const visited = new Set();
  const violations = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const { file, chain } = current;
    if (visited.has(file)) continue;
    visited.add(file);

    const relFile = path.relative(projectRoot, file).split(path.sep).join("/");
    const chainDisplay = chain
      .map((p) => path.relative(projectRoot, p).split(path.sep).join("/"))
      .join(" -> ");

    // Check workspace boundary on transitive target
    for (const fb of forbiddenAbsDirs) {
      if (file === fb.abs || file.startsWith(`${fb.abs}${path.sep}`)) {
        violations.push(
          `${chainDisplay} — Transitive import enters forbidden directory "${fb.label}/*"`,
        );
      }
    }

    const insideAllowed = allowedAbsDirs.some(
      (allowed) => file === allowed || file.startsWith(`${allowed}${path.sep}`),
    );
    if (!insideAllowed) {
      violations.push(
        `${chainDisplay} — Transitive import "${relFile}" is outside allowed core roots (${allowedRelDirs.join(", ")})`,
      );
    }

    const content = fs.readFileSync(file, "utf-8");
    const sourceFile = ts.createSourceFile(
      file,
      content,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS,
    );

    const { specs, astViolations } = inspectSourceAst(sourceFile, relFile);
    for (const v of astViolations) {
      violations.push(chain.length > 1 ? `${v} (via ${chainDisplay})` : v);
    }

    for (const { specifier, loc } of specs) {
      const specErr = isForbiddenSpecifier(specifier);
      if (specErr) {
        const prefix =
          chain.length > 1
            ? `${relFile}:${loc} (via ${chainDisplay})`
            : `${relFile}:${loc}`;
        violations.push(`${prefix} — ${specErr}`);
        continue;
      }

      const resolved = resolveRelativeImport(file, specifier);
      if (!resolved) {
        violations.push(
          `${relFile}:${loc} — Unable to resolve import "${specifier}"`,
        );
        continue;
      }

      if (!visited.has(resolved)) {
        queue.push({ file: resolved, chain: [...chain, resolved] });
      }
    }
  }

  const checkedFiles = Array.from(visited)
    .map((f) => path.relative(projectRoot, f).split(path.sep).join("/"))
    .sort();

  return {
    ok: violations.length === 0,
    checkedFiles,
    violations,
  };
}

const isDirectExecution = (() => {
  if (!process.argv[1]) return false;
  try {
    return (
      fs.realpathSync(fileURLToPath(import.meta.url)) ===
      fs.realpathSync(path.resolve(process.argv[1]))
    );
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  const result = checkCorePurity();
  if (!result.ok) {
    console.error("❌ Core purity check failed:");
    for (const v of result.violations) {
      console.error(`  - ${v}`);
    }
    process.exit(1);
  }
  console.log(
    `✅ Core purity check passed (${result.checkedFiles.length} transitive files verified).`,
  );
}
