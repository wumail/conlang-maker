/**
 * ruleDsl.ts — 单行语言学规则 DSL ↔ 结构体双向无损引擎（PRD §3.4 / EXECUTION_PLAN §7.4）
 *
 * 统一语法：`<target> -> <replacement> / <before> _ <after>  ! <exceptions>  # <说明>  @id:<rule_id>`
 *  - 箭头兼容 `->` / `>` / `→`；空串序列化为 `∅`，解析同时接受 `∅` 与 `0`；
 *  - `@id:` 保真：序列化始终附在行尾，解析缺失时自动生成新 id；
 *  - 行号从 1 开始，空行与 `#` 开头的整行注释被忽略。
 */
import type {
  AllophonyRule,
  FeatureExpression,
  FeatureReplacement,
  RomanizationRule,
  SCARule,
} from "../../types";

export interface DslDiagnostic {
  line: number;
  message: string;
}

export interface DslParseResult<T> {
  rules: T[];
  diagnostics: DslDiagnostic[];
}

const EMPTY_MARKER = "∅";
const ID_PATTERN = /@id:([A-Za-z0-9_.:-]+)\s*$/;

function emptyToMarker(value: string): string {
  return value.trim() === "" ? EMPTY_MARKER : value.trim();
}

function markerToEmpty(value: string): string {
  const trimmed = value.trim();
  if (trimmed === EMPTY_MARKER || trimmed === "0") return "";
  return trimmed;
}

function newRuleId(prefix: string): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}_${suffix}`;
}

/** 抽掉行尾 `@id:`，返回正文与 id */
function splitRuleId(raw: string): { body: string; ruleId: string | null } {
  const match = ID_PATTERN.exec(raw);
  if (!match) return { body: raw, ruleId: null };
  return { body: raw.slice(0, match.index).trimEnd(), ruleId: match[1] ?? null };
}

/**
 * 抽掉 `#` 后说明文字（保留正文）。
 *
 * 语境里的 `#` 是词界标记（如 ` / # _ #`），只有紧邻 `_`（忽略空格）的 `#` 才是词界符；
 * 其余「前带空白的 `#`」一律视为说明注释的起点——说明文字里允许出现 `_`、`/`
 * （如 `# voiced_stop`、`# C/V`），不得被误判为规则正文。
 */
function isBoundaryHash(raw: string, index: number): boolean {
  const before = raw.slice(0, index).trimEnd();
  const after = raw.slice(index + 1).trimStart();
  return before.endsWith("_") || after.startsWith("_");
}

function splitDescription(raw: string): { body: string; description: string } {
  for (let index = raw.length - 1; index >= 0; index -= 1) {
    if (raw[index] !== "#") continue;
    // 说明分隔符必须前带空白，避免切断 `a#b` 这类正文
    if (index > 0 && !/\s/.test(raw[index - 1] ?? "")) continue;
    const tail = raw.slice(index + 1).trim();
    if (!tail) continue;
    if (isBoundaryHash(raw, index)) continue;
    return { body: raw.slice(0, index).trim(), description: tail };
  }
  return { body: raw.trim(), description: "" };
}

/** 抽出 `!` 后的例外列表（仅音变规则） */
function splitExceptions(raw: string): { body: string; exceptions: string[] } {
  const index = raw.indexOf("!");
  if (index < 0) return { body: raw.trim(), exceptions: [] };
  const list = raw
    .slice(index + 1)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return { body: raw.slice(0, index).trim(), exceptions: list };
}

function findArrowIndex(body: string): { index: number; length: number } | null {
  for (const arrow of ["->", "→", ">"]) {
    const index = body.indexOf(arrow);
    if (index >= 0) return { index, length: arrow.length };
  }
  return null;
}

interface RuleParts {
  target: string;
  replacement: string;
  before: string;
  after: string;
  hasContext: boolean;
  hasArrow: boolean;
}

function splitRuleBody(body: string): RuleParts | null {
  const arrow = findArrowIndex(body);
  if (!arrow) return null;

  const left = body.slice(0, arrow.index).trim();
  let right = body.slice(arrow.index + arrow.length).trim();

  let before = "";
  let after = "";
  let hasContext = false;
  const contextMatch = /\s\/\s/.exec(right);
  if (contextMatch) {
    const context = right.slice(contextMatch.index + contextMatch[0].length);
    right = right.slice(0, contextMatch.index).trim();
    const underscore = context.indexOf("_");
    if (underscore >= 0) {
      before = context.slice(0, underscore).trim();
      after = context.slice(underscore + 1).trim();
      hasContext = before !== "" || after !== "";
    } else {
      before = context.trim();
      hasContext = before !== "";
    }
  }

  return {
    target: markerToEmpty(left),
    replacement: markerToEmpty(right),
    before: markerToEmpty(before),
    after: markerToEmpty(after),
    hasContext,
    hasArrow: true,
  };
}

/* ────────────────────────── 1. 罗马化规则 ────────────────────────── */

export function serializeRomanizationDsl(rules: RomanizationRule[]): string {
  return rules
    .map((rule) => {
      const input = emptyToMarker(rule.input);
      const isSeparator = rule.output_type === "separator";
      const output = isSeparator ? "[sep]" : emptyToMarker(rule.output_phoneme);
      const before = (rule.context_before ?? "").trim();
      const after = (rule.context_after ?? "").trim();
      const context = before || after ? ` / ${before} _ ${after}` : "";
      return `${input} -> ${output}${context}  @id:${rule.rule_id}`;
    })
    .join("\n");
}

export function parseRomanizationDsl(text: string): DslParseResult<RomanizationRule> {
  const rules: RomanizationRule[] = [];
  const diagnostics: DslDiagnostic[] = [];

  text.split("\n").forEach((raw, index) => {
    const lineNo = index + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const { body: withoutId, ruleId } = splitRuleId(trimmed);
    const parts = splitRuleBody(withoutId);
    if (!parts) {
      diagnostics.push({ line: lineNo, message: "Missing arrow (-> / > / →)" });
      return;
    }

    const isSeparator = parts.replacement.trim() === "[sep]";
    rules.push({
      rule_id: ruleId ?? newRuleId("rule"),
      input: parts.target,
      output_phoneme: isSeparator ? "" : parts.replacement,
      context_before: parts.before,
      context_after: parts.after,
      ...(isSeparator ? { output_type: "separator" as const } : {}),
    });
  });

  return { rules, diagnostics };
}

/* ────────────────────────── 2. 音位变体规则 ────────────────────────── */

export function serializeAllophonyDsl(rules: AllophonyRule[]): string {
  return rules
    .map((rule) => {
      const before = (rule.context_before ?? "").trim();
      const after = (rule.context_after ?? "").trim();
      const context = before || after ? ` / ${before} _ ${after}` : "";
      const description = rule.description?.trim() ? `  # ${rule.description.trim()}` : "";
      return `${emptyToMarker(rule.target)} -> ${emptyToMarker(rule.replacement)}${context}${description}  @id:${rule.rule_id}`;
    })
    .join("\n");
}

export function parseAllophonyDsl(text: string): DslParseResult<AllophonyRule> {
  const rules: AllophonyRule[] = [];
  const diagnostics: DslDiagnostic[] = [];

  text.split("\n").forEach((raw, index) => {
    const lineNo = index + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const { body: withoutId, ruleId } = splitRuleId(trimmed);
    const { body, description } = splitDescription(withoutId);
    const parts = splitRuleBody(body);
    if (!parts) {
      diagnostics.push({ line: lineNo, message: "Missing arrow (-> / > / →)" });
      return;
    }

    rules.push({
      rule_id: ruleId ?? newRuleId("allo"),
      description,
      target: parts.target,
      replacement: parts.replacement,
      context_before: parts.before,
      context_after: parts.after,
      priority: rules.length + 1,
    });
  });

  return { rules, diagnostics };
}

/* ────────────────────────── 3. 历时音变规则 ────────────────────────── */

function isFeatureToken(text: string): boolean {
  return /^\[.*[+-].*\]$/.test(text.trim());
}

function parseFeatureExpression(text: string): FeatureExpression | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const positive: string[] = [];
  const negative: string[] = [];
  for (const token of trimmed.slice(1, -1).split(",")) {
    const item = token.trim();
    if (!item) continue;
    if (item.startsWith("+")) positive.push(item.slice(1).trim());
    else if (item.startsWith("-")) negative.push(item.slice(1).trim());
    else positive.push(item);
  }
  return { positive, negative };
}

function parseFeatureReplacement(text: string): FeatureReplacement | null {
  const expression = parseFeatureExpression(text);
  if (!expression) return null;
  return {
    set_features: expression.positive,
    remove_features: expression.negative,
  };
}

function serializeFeatureExpression(features: FeatureExpression | null): string {
  if (!features) return EMPTY_MARKER;
  const items = [
    ...features.positive.map((feature) => `+${feature}`),
    ...features.negative.map((feature) => `-${feature}`),
  ];
  return items.length > 0 ? `[${items.join(", ")}]` : EMPTY_MARKER;
}

function serializeFeatureReplacement(features: FeatureReplacement | null): string {
  if (!features) return EMPTY_MARKER;
  return serializeFeatureExpression({
    positive: features.set_features,
    negative: features.remove_features,
  });
}

export function serializeScaRulesDsl(rules: SCARule[]): string {
  return rules
    .map((rule) => {
      const before = (rule.context_before ?? "").trim();
      const after = (rule.context_after ?? "").trim();
      const exceptions = rule.exceptions.length > 0 ? `  ! ${rule.exceptions.join(", ")}` : "";
      const description = rule.description?.trim() ? `  # ${rule.description.trim()}` : "";

      const target = rule.feature_mode
        ? serializeFeatureExpression(rule.target_features)
        : emptyToMarker(rule.target);
      const replacement = rule.feature_mode
        ? serializeFeatureReplacement(rule.replacement_features)
        : emptyToMarker(rule.replacement);
      const beforeText = rule.feature_mode
        ? serializeFeatureExpression(rule.context_before_features)
        : before;
      const afterText = rule.feature_mode
        ? serializeFeatureExpression(rule.context_after_features)
        : after;
      const contextText =
        rule.feature_mode && beforeText === EMPTY_MARKER && afterText === EMPTY_MARKER
          ? ""
          : beforeText || afterText
            ? ` / ${beforeText} _ ${afterText}`
            : "";

      return `${target} -> ${replacement}${contextText}${exceptions}${description}  @id:${rule.rule_id}`;
    })
    .join("\n");
}

export function parseScaRulesDsl(text: string): DslParseResult<SCARule> {
  const rules: SCARule[] = [];
  const diagnostics: DslDiagnostic[] = [];

  text.split("\n").forEach((raw, index) => {
    const lineNo = index + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const { body: withoutId, ruleId } = splitRuleId(trimmed);
    const { body: withoutDescription, description } = splitDescription(withoutId);
    const { body, exceptions } = splitExceptions(withoutDescription);
    const parts = splitRuleBody(body);
    if (!parts) {
      diagnostics.push({ line: lineNo, message: "Missing arrow (-> / > / →)" });
      return;
    }

    const featureMode =
      isFeatureToken(parts.target) ||
      isFeatureToken(parts.replacement) ||
      isFeatureToken(parts.before) ||
      isFeatureToken(parts.after);

    if (featureMode) {
      const targetFeatures = parseFeatureExpression(parts.target);
      const replacementFeatures = parseFeatureReplacement(parts.replacement);
      if (!targetFeatures || !replacementFeatures) {
        diagnostics.push({
          line: lineNo,
          message: "Feature rule needs [+/-feature] on both sides",
        });
        return;
      }
      rules.push({
        rule_id: ruleId ?? newRuleId("sca"),
        description,
        target: "",
        replacement: "",
        context_before: "",
        context_after: "",
        exceptions,
        feature_mode: true,
        target_features: targetFeatures,
        replacement_features: replacementFeatures,
        context_before_features: parseFeatureExpression(parts.before),
        context_after_features: parseFeatureExpression(parts.after),
      });
      return;
    }

    rules.push({
      rule_id: ruleId ?? newRuleId("sca"),
      description,
      target: parts.target,
      replacement: parts.replacement,
      context_before: parts.before,
      context_after: parts.after,
      exceptions,
      feature_mode: false,
      target_features: null,
      replacement_features: null,
      context_before_features: null,
      context_after_features: null,
    });
  });

  return { rules, diagnostics };
}
