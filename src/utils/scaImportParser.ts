import type { FeatureExpression, FeatureReplacement, SCARule } from "../types";

export interface ParsedSCARuleInput {
  description: string;
  target: string;
  replacement: string;
  context_before: string;
  context_after: string;
  exceptions: string[];
  feature_mode: boolean;
  target_features: FeatureExpression | null;
  replacement_features: FeatureReplacement | null;
  context_before_features: FeatureExpression | null;
  context_after_features: FeatureExpression | null;
}

export interface SCARuleImportError {
  line: number;
  reason: string;
  source: string;
}

export interface ParseSCARulesResult {
  rules: ParsedSCARuleInput[];
  errors: SCARuleImportError[];
}

const BOUNDARY_FEATURE = "__BOUNDARY__";

function parseExceptions(raw: string): string[] {
  return raw
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function encodeFeatureName(name: string): string {
  return name === "#" ? BOUNDARY_FEATURE : name;
}

function decodeFeatureName(name: string): string {
  return name === BOUNDARY_FEATURE ? "#" : name;
}

function parseFeatureExpressionText(raw: string): FeatureExpression | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const cleaned = trimmed.replace(/^\[/, "").replace(/\]$/, "");
  const parts = cleaned
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const expr: FeatureExpression = { positive: [], negative: [] };
  for (const part of parts) {
    if (part.startsWith("+")) {
      expr.positive.push(encodeFeatureName(part.slice(1).trim()));
    } else if (part.startsWith("-")) {
      expr.negative.push(encodeFeatureName(part.slice(1).trim()));
    } else {
      expr.positive.push(encodeFeatureName(part));
    }
  }

  return expr;
}

function parseFeatureReplacementText(raw: string): FeatureReplacement | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parts = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const repl: FeatureReplacement = { set_features: [], remove_features: [] };
  for (const part of parts) {
    if (part.startsWith("-")) {
      repl.remove_features.push(encodeFeatureName(part.slice(1).trim()));
    } else if (part.startsWith("+")) {
      repl.set_features.push(encodeFeatureName(part.slice(1).trim()));
    } else {
      repl.set_features.push(encodeFeatureName(part));
    }
  }

  return repl;
}

function formatFeatureExpressionText(expr: FeatureExpression | null): string {
  if (!expr) return "";
  const plus = expr.positive.map((f) => `+${decodeFeatureName(f)}`);
  const minus = expr.negative.map((f) => `-${decodeFeatureName(f)}`);
  const tokens = [...plus, ...minus];
  if (tokens.length === 0) return "";
  return `[${tokens.join(", ")}]`;
}

function formatFeatureReplacementText(repl: FeatureReplacement | null): string {
  if (!repl) return "";
  const plus = repl.set_features.map((f) => `+${decodeFeatureName(f)}`);
  const minus = repl.remove_features.map((f) => `-${decodeFeatureName(f)}`);
  return [...plus, ...minus].join(", ");
}

function normalizeField(raw: string): string {
  return (raw || "").replace(/\|/g, "/").trim();
}

function parseContext(raw: string): { before: string; after: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { before: "", after: "" };

  const underscoreIndex = trimmed.indexOf("_");
  if (underscoreIndex >= 0) {
    return {
      before: trimmed.slice(0, underscoreIndex).trim(),
      after: trimmed.slice(underscoreIndex + 1).trim(),
    };
  }

  if (trimmed.startsWith("_")) {
    return { before: "", after: trimmed.slice(1).trim() };
  }
  if (trimmed.endsWith("_")) {
    return { before: trimmed.slice(0, -1).trim(), after: "" };
  }

  return { before: trimmed, after: "" };
}

function parseDelimitedLine(line: string): ParsedSCARuleInput | null {
  const separator = line.includes("|") ? "|" : line.includes("\t") ? "\t" : "";
  if (!separator) return null;

  const parts = line.split(separator).map((part) => part.trim());
  if (parts.length < 2) return null;

  if ((parts[1] || "").toLowerCase() === "@feature") {
    const targetFeatures = parseFeatureExpressionText(parts[2] || "");
    const replacementFeatures = parseFeatureReplacementText(parts[3] || "");
    if (!targetFeatures || !replacementFeatures) return null;

    return {
      description: parts[0] || "",
      target: "",
      replacement: "",
      context_before: "",
      context_after: "",
      exceptions: parseExceptions(parts.slice(6).join(",")),
      feature_mode: true,
      target_features: targetFeatures,
      replacement_features: replacementFeatures,
      context_before_features: parseFeatureExpressionText(parts[4] || ""),
      context_after_features: parseFeatureExpressionText(parts[5] || ""),
    };
  }

  let description = "";
  let target = "";
  let replacement = "";
  let contextBefore = "";
  let contextAfter = "";
  let exceptions: string[] = [];

  if (parts.length >= 6) {
    description = parts[0];
    target = parts[1];
    replacement = parts[2];
    contextBefore = parts[3];
    contextAfter = parts[4];
    exceptions = parseExceptions(parts.slice(5).join(","));
  } else if (parts.length === 5) {
    description = parts[0];
    target = parts[1];
    replacement = parts[2];
    contextBefore = parts[3];
    contextAfter = parts[4];
  } else if (parts.length === 4) {
    target = parts[0];
    replacement = parts[1];
    contextBefore = parts[2];
    contextAfter = parts[3];
  } else if (parts.length === 3) {
    target = parts[0];
    replacement = parts[1];
    const parsedContext = parseContext(parts[2]);
    contextBefore = parsedContext.before;
    contextAfter = parsedContext.after;
  } else {
    target = parts[0];
    replacement = parts[1];
  }

  if (!target || !replacement) return null;

  return {
    description,
    target,
    replacement,
    context_before: contextBefore,
    context_after: contextAfter,
    exceptions,
    feature_mode: false,
    target_features: null,
    replacement_features: null,
    context_before_features: null,
    context_after_features: null,
  };
}

function extractExceptions(raw: string): {
  body: string;
  exceptions: string[];
} {
  const exceptMatch = raw.match(/^(.*?)(?:\s+!\s*|\s+except\s+)(.+)$/i);
  if (!exceptMatch) {
    return { body: raw.trim(), exceptions: [] };
  }
  return {
    body: exceptMatch[1].trim(),
    exceptions: parseExceptions(exceptMatch[2]),
  };
}

function parseArrowLine(line: string): ParsedSCARuleInput | null {
  const arrowMatch = line.match(/^(.*?)\s*(?:->|=>|>|→)\s*(.+)$/);
  if (!arrowMatch) return null;

  let target = arrowMatch[1].trim();
  if (!target) return null;

  let description = "";
  const descSplit = target.match(/^(.*?)[：:](.+)$/);
  if (descSplit && descSplit[1].trim() && descSplit[2].trim()) {
    description = descSplit[1].trim();
    target = descSplit[2].trim();
  }

  const rhs = arrowMatch[2].trim();
  if (!rhs) return null;

  let replacementRaw = rhs;
  let contextRaw = "";

  const slashIndex = rhs.indexOf("/");
  if (slashIndex >= 0) {
    replacementRaw = rhs.slice(0, slashIndex).trim();
    contextRaw = rhs.slice(slashIndex + 1).trim();
  }

  const replacementParsed = extractExceptions(replacementRaw);
  const contextParsed = extractExceptions(contextRaw);
  const parsedContext = parseContext(contextParsed.body);

  if (!replacementParsed.body) return null;

  return {
    description,
    target,
    replacement: replacementParsed.body,
    context_before: parsedContext.before,
    context_after: parsedContext.after,
    exceptions: [...replacementParsed.exceptions, ...contextParsed.exceptions],
    feature_mode: false,
    target_features: null,
    replacement_features: null,
    context_before_features: null,
    context_after_features: null,
  };
}

function serializeSCARuleLine(rule: SCARule): string {
  const exceptions = (rule.exceptions || []).join(", ");
  const description = normalizeField(rule.description || "");

  if (rule.feature_mode) {
    return [
      description,
      "@feature",
      formatFeatureExpressionText(rule.target_features),
      formatFeatureReplacementText(rule.replacement_features),
      formatFeatureExpressionText(rule.context_before_features),
      formatFeatureExpressionText(rule.context_after_features),
      exceptions,
    ].join(" | ");
  }

  return [
    description,
    normalizeField(rule.target || ""),
    normalizeField(rule.replacement || ""),
    normalizeField(rule.context_before || ""),
    normalizeField(rule.context_after || ""),
    exceptions,
  ].join(" | ");
}

export function serializeSCARuleSetForImport(
  ruleSetName: string,
  rules: SCARule[],
): string {
  const lines = [
    `# Rule Set: ${ruleSetName || "Unnamed"}`,
    "# Character format: description | target | replacement | before | after | exceptions",
    "# Feature format: description | @feature | targetFeatures | replacementOps | beforeFeatures | afterFeatures | exceptions",
    ...rules.map((rule) => serializeSCARuleLine(rule)),
  ];
  return lines.join("\n");
}

export function parseSCARulesText(text: string): ParseSCARulesResult {
  const rules: ParsedSCARuleInput[] = [];
  const errors: SCARuleImportError[] = [];

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const source = lines[i];
    const line = source.trim();

    if (!line) continue;
    if (line.startsWith("#") || line.startsWith("//") || line.startsWith(";")) {
      continue;
    }

    const normalized = line.replace(/^[-*]\s+/, "");
    const parsed = parseDelimitedLine(normalized) || parseArrowLine(normalized);

    if (!parsed) {
      errors.push({
        line: i + 1,
        reason: "unrecognized_format",
        source,
      });
      continue;
    }

    if (
      (!parsed.feature_mode && (!parsed.target || !parsed.replacement)) ||
      (parsed.feature_mode &&
        (!parsed.target_features || !parsed.replacement_features))
    ) {
      errors.push({
        line: i + 1,
        reason: "missing_target_or_replacement",
        source,
      });
      continue;
    }

    rules.push(parsed);
  }

  return { rules, errors };
}
