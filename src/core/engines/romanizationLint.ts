import {
  PhonemeInventory,
  PhonologyConfig,
  RomanizationMap,
  RomanizationRule,
} from "../../types";
import { tokenizePhonemes } from "./phonemeTokenizer";

export interface UnreachablePhonemeIssue {
  phoneme: string;
  category: "consonant" | "vowel";
}

export interface UnknownOutputPhonemeIssue {
  map_id: string;
  map_name: string;
  rule_id: string;
  input: string;
  output_phoneme: string;
  unknown_tokens: string[];
}

export interface ConflictingRuleEntry {
  rule_id: string;
  input: string;
  output_phoneme: string;
}

export interface ConflictingRuleIssue {
  map_id: string;
  map_name: string;
  input: string;
  context_before: string;
  context_after: string;
  rules: ConflictingRuleEntry[];
}

export interface DuplicateRuleIssue {
  map_id: string;
  map_name: string;
  input: string;
  context_before: string;
  context_after: string;
  output_phoneme: string;
  rule_ids: string[];
}

export interface ShadowedRuleIssue {
  map_id: string;
  map_name: string;
  shadowed_rule_id: string;
  shadowed_input: string;
  shadowed_context_before: string;
  shadowed_context_after: string;
  shadowed_by_rule_id: string;
  shadowed_by_input: string;
  shadowed_by_context_before: string;
  shadowed_by_context_after: string;
  reason: "same_position_greedy_or_specificity" | "left_greedy_consumption";
}

export type CaseIssueReason =
  | "case_collision"
  | "uppercase_input_case_folded"
  | "uppercase_context_case_folded";

export interface CaseIssue {
  map_id: string;
  map_name: string;
  rule_id: string;
  input: string;
  context_before: string;
  context_after: string;
  reason: CaseIssueReason;
  colliding_rule_ids?: string[];
}

export interface RomanizationAnalyzeOptions {
  /** `"default"` (default), `"all"`, or a specific `map_id`. */
  mapScope?: "default" | "all" | string;
}

export interface RomanizationAnalysisResult {
  map_ids: string[];
  unreachable_phonemes: UnreachablePhonemeIssue[];
  unknown_output_phonemes: UnknownOutputPhonemeIssue[];
  conflicting_rules: ConflictingRuleIssue[];
  duplicate_rules: DuplicateRuleIssue[];
  shadowed_rules: ShadowedRuleIssue[];
  case_issues: CaseIssue[];
  summary: {
    total_rules: number;
    issue_count: number;
    unreachable_phonemes: number;
    unknown_output_phonemes: number;
    conflicting_rules: number;
    duplicate_rules: number;
    shadowed_rules: number;
    case_issues: number;
  };
}

interface NormalizedRuleInfo {
  rule: RomanizationRule;
  order: number;
  rawInputNfc: string;
  foldedInput: string;
  inputChars: string[];
  charCount: number;
  rawBeforeNfc: string;
  beforeBoundary: boolean;
  beforeFolded: string;
  beforeChars: string[];
  rawAfterNfc: string;
  afterBoundary: boolean;
  afterFolded: string;
  afterChars: string[];
  contextSpecificity: number;
  conditionKey: string;
  normalizedOutput: string;
}

function parseNormalizedRule(
  rule: RomanizationRule,
  order: number,
): NormalizedRuleInfo | null {
  const rawInputNfc = (rule.input ?? "").normalize("NFC");
  if (!rawInputNfc) return null;

  const foldedInput = rawInputNfc.toLowerCase();
  const inputChars = Array.from(foldedInput);

  const rawBeforeTrim = (rule.context_before ?? "").trim().normalize("NFC");
  const normBefore = rawBeforeTrim === "_" ? "" : rawBeforeTrim;
  const beforeBoundary = normBefore.startsWith("#");
  const beforeLiteral = beforeBoundary ? normBefore.slice(1) : normBefore;
  const beforeFolded = beforeLiteral.toLowerCase();
  const beforeChars = Array.from(beforeFolded);

  const rawAfterTrim = (rule.context_after ?? "").trim().normalize("NFC");
  const normAfter = rawAfterTrim === "_" ? "" : rawAfterTrim;
  const afterBoundary = normAfter.endsWith("#");
  const afterLiteral = afterBoundary ? normAfter.slice(0, -1) : normAfter;
  const afterFolded = afterLiteral.toLowerCase();
  const afterChars = Array.from(afterFolded);

  const contextSpecificity =
    beforeChars.length +
    afterChars.length +
    (beforeBoundary ? 1 : 0) +
    (afterBoundary ? 1 : 0);

  const conditionKey = `${beforeBoundary ? "#" : ""}${beforeFolded}|${foldedInput}|${afterFolded}${afterBoundary ? "#" : ""}`;
  const normalizedOutput = rule.output_type === "separator" ? "" : (rule.output_phoneme ?? "").normalize("NFC");

  return {
    rule,
    order,
    rawInputNfc,
    foldedInput,
    inputChars,
    charCount: inputChars.length,
    rawBeforeNfc: normBefore,
    beforeBoundary,
    beforeFolded,
    beforeChars,
    rawAfterNfc: normAfter,
    afterBoundary,
    afterFolded,
    afterChars,
    contextSpecificity,
    conditionKey,
    normalizedOutput,
  };
}

function compileMapRules(rules: RomanizationRule[]): NormalizedRuleInfo[] {
  const parsed: NormalizedRuleInfo[] = [];
  for (let i = 0; i < rules.length; i += 1) {
    const info = parseNormalizedRule(rules[i], i);
    if (info) parsed.push(info);
  }
  parsed.sort(
    (a, b) =>
      b.charCount - a.charCount ||
      b.contextSpecificity - a.contextSpecificity ||
      a.order - b.order,
  );
  return parsed;
}

export function selectRomanizationMaps(
  config: PhonologyConfig,
  mapScope: "default" | "all" | string = "default",
): RomanizationMap[] {
  if (mapScope === "all") {
    return config.romanization_maps;
  }
  if (mapScope === "default") {
    const def =
      config.romanization_maps.find((m) => m.is_default) ??
      config.romanization_maps[0];
    return def ? [def] : [];
  }
  return config.romanization_maps.filter((m) => m.map_id === mapScope);
}

/**
 * 1. Inventory phonemes that are never produced by any rule in `maps`.
 */
export function findUnreachablePhonemes(
  inventory: PhonemeInventory,
  maps: RomanizationMap[],
): UnreachablePhonemeIssue[] {
  const normalizedConsonants = inventory.consonants.map((c) => ({
    raw: c,
    norm: c.normalize("NFC"),
  }));
  const normalizedVowels = inventory.vowels.map((v) => ({
    raw: v,
    norm: v.normalize("NFC"),
  }));
  const allKnownNorm = [
    ...normalizedConsonants.map((c) => c.norm),
    ...normalizedVowels.map((v) => v.norm),
  ];

  const produced = new Set<string>();
  for (const map of maps) {
    for (const rule of map.rules) {
      if (!(rule.input ?? "").normalize("NFC")) continue;
      if (rule.output_type === "separator") continue;
      const out = (rule.output_phoneme ?? "").trim().normalize("NFC");
      if (!out) continue;
      produced.add(out);
      for (const tok of tokenizePhonemes(out, allKnownNorm)) {
        if (tok.trim()) produced.add(tok);
      }
    }
  }

  const issues: UnreachablePhonemeIssue[] = [];
  const seen = new Set<string>();

  for (const c of normalizedConsonants) {
    if (!c.norm || seen.has(`c:${c.norm}`)) continue;
    seen.add(`c:${c.norm}`);
    if (!produced.has(c.norm)) {
      issues.push({ phoneme: c.raw, category: "consonant" });
    }
  }
  for (const v of normalizedVowels) {
    if (!v.norm || seen.has(`v:${v.norm}`)) continue;
    seen.add(`v:${v.norm}`);
    if (!produced.has(v.norm)) {
      issues.push({ phoneme: v.raw, category: "vowel" });
    }
  }

  return issues;
}

/**
 * 2. Rules whose `output_phoneme` contains phoneme tokens absent from `phoneme_inventory`.
 */
export function findUnknownOutputPhonemes(
  inventory: PhonemeInventory,
  maps: RomanizationMap[],
): UnknownOutputPhonemeIssue[] {
  const knownSet = new Set<string>(
    [...inventory.consonants, ...inventory.vowels]
      .map((p) => p.normalize("NFC"))
      .filter(Boolean),
  );
  const knownList = Array.from(knownSet);
  const issues: UnknownOutputPhonemeIssue[] = [];

  for (const map of maps) {
    for (const rule of map.rules) {
      if (!(rule.input ?? "").normalize("NFC")) continue;
      if (rule.output_type === "separator") continue;
      const out = (rule.output_phoneme ?? "").trim().normalize("NFC");
      if (!out) continue;
      if (knownSet.has(out)) continue;

      const tokens = tokenizePhonemes(out, knownList).filter(
        (t) => t.trim().length > 0,
      );
      const unknown = tokens.filter((t) => !knownSet.has(t));
      if (unknown.length > 0) {
        issues.push({
          map_id: map.map_id,
          map_name: map.name,
          rule_id: rule.rule_id,
          input: rule.input,
          output_phoneme: rule.output_phoneme,
          unknown_tokens: Array.from(new Set(unknown)),
        });
      }
    }
  }

  return issues;
}

/**
 * 3. Rules within the same map sharing identical normalized `(input, context_before, context_after)`
 *    but producing different `output_phoneme`.
 */
export function findConflictingRules(
  maps: RomanizationMap[],
): ConflictingRuleIssue[] {
  const issues: ConflictingRuleIssue[] = [];

  for (const map of maps) {
    const groups = new Map<string, NormalizedRuleInfo[]>();
    for (let i = 0; i < map.rules.length; i += 1) {
      const info = parseNormalizedRule(map.rules[i], i);
      if (!info) continue;
      const list = groups.get(info.conditionKey) ?? [];
      list.push(info);
      groups.set(info.conditionKey, list);
    }

    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const distinctOutputs = new Set(group.map((g) => g.normalizedOutput));
      if (distinctOutputs.size > 1) {
        const first = group[0].rule;
        issues.push({
          map_id: map.map_id,
          map_name: map.name,
          input: first.input,
          context_before: first.context_before ?? "",
          context_after: first.context_after ?? "",
          rules: group.map((g) => ({
            rule_id: g.rule.rule_id,
            input: g.rule.input,
            output_phoneme: g.rule.output_phoneme,
          })),
        });
      }
    }
  }

  return issues;
}

/**
 * 4. Rules within the same map sharing identical normalized `(input, context_before, context_after, output_phoneme)`.
 */
export function findDuplicateRules(
  maps: RomanizationMap[],
): DuplicateRuleIssue[] {
  const issues: DuplicateRuleIssue[] = [];

  for (const map of maps) {
    const groups = new Map<string, NormalizedRuleInfo[]>();
    for (let i = 0; i < map.rules.length; i += 1) {
      const info = parseNormalizedRule(map.rules[i], i);
      if (!info) continue;
      const key = `${info.conditionKey}=>${info.normalizedOutput}`;
      const list = groups.get(key) ?? [];
      list.push(info);
      groups.set(key, list);
    }

    for (const group of groups.values()) {
      if (group.length >= 2) {
        const first = group[0].rule;
        issues.push({
          map_id: map.map_id,
          map_name: map.name,
          input: first.input,
          context_before: first.context_before ?? "",
          context_after: first.context_after ?? "",
          output_phoneme: first.output_phoneme,
          rule_ids: group.map((g) => g.rule.rule_id),
        });
      }
    }
  }

  return issues;
}

function arrayStartsWith(haystack: string[], prefix: string[]): boolean {
  if (prefix.length > haystack.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (haystack[i] !== prefix[i]) return false;
  }
  return true;
}

function arrayEndsWith(haystack: string[], suffix: string[]): boolean {
  if (suffix.length > haystack.length) return false;
  const offset = haystack.length - suffix.length;
  for (let i = 0; i < suffix.length; i += 1) {
    if (haystack[offset + i] !== suffix[i]) return false;
  }
  return true;
}

function subsumesAtSamePosition(
  higher: NormalizedRuleInfo,
  lower: NormalizedRuleInfo,
): boolean {
  const lowerRight = [...lower.inputChars, ...lower.afterChars];
  const higherRight = [...higher.inputChars, ...higher.afterChars];
  if (!arrayStartsWith(lowerRight, higherRight)) return false;
  if (
    higher.afterBoundary &&
    (!lower.afterBoundary || lowerRight.length !== higherRight.length)
  ) {
    return false;
  }

  if (!arrayEndsWith(lower.beforeChars, higher.beforeChars)) return false;
  if (
    higher.beforeBoundary &&
    (!lower.beforeBoundary ||
      lower.beforeChars.length !== higher.beforeChars.length)
  ) {
    return false;
  }

  return true;
}

function subsumesViaLeftConsumption(
  consumer: NormalizedRuleInfo,
  target: NormalizedRuleInfo,
  allCompiled: NormalizedRuleInfo[],
): boolean {
  if (target.beforeChars.length === 0) return false;

  for (let offset = 1; offset <= target.beforeChars.length; offset += 1) {
    if (consumer.charCount <= offset) continue;

    const guaranteedLeft = target.beforeChars.slice(
      0,
      target.beforeChars.length - offset,
    );
    const guaranteedLeftBoundary =
      target.beforeBoundary && offset === target.beforeChars.length;
    const consumedPrefix = target.beforeChars.slice(
      target.beforeChars.length - offset,
    );
    const guaranteedRight = [
      ...consumedPrefix,
      ...target.inputChars,
      ...target.afterChars,
    ];
    const consumerRight = [...consumer.inputChars, ...consumer.afterChars];

    if (!arrayStartsWith(guaranteedRight, consumerRight)) continue;
    if (
      consumer.afterBoundary &&
      (!target.afterBoundary || guaranteedRight.length !== consumerRight.length)
    ) {
      continue;
    }
    if (!arrayEndsWith(guaranteedLeft, consumer.beforeChars)) continue;
    if (
      consumer.beforeBoundary &&
      (!guaranteedLeftBoundary ||
        guaranteedLeft.length !== consumer.beforeChars.length)
    ) {
      continue;
    }

    // Check if any multi-char rule can jump across `pos - offset` and end at `pos`
    // (or inside `consumedPrefix`), allowing the scanner to land directly on `pos`.
    const hasBridgeRule = allCompiled.some((r) => {
      if (r.charCount < 2) return false;
      for (let tailLen = 1; tailLen <= consumedPrefix.length; tailLen += 1) {
        if (r.charCount <= tailLen) continue;
        const neededSuffix = consumedPrefix.slice(0, tailLen);
        if (arrayEndsWith(r.inputChars, neededSuffix)) {
          return true;
        }
      }
      return false;
    });

    if (!hasBridgeRule) {
      return true;
    }
  }

  return false;
}

/**
 * 5. Rules with distinct conditions that can never fire because a higher-priority
 *    compiled rule (longer input or greedy left-to-right consumption) always matches first.
 */
export function findShadowedRules(
  maps: RomanizationMap[],
): ShadowedRuleIssue[] {
  const issues: ShadowedRuleIssue[] = [];

  for (const map of maps) {
    const compiled = compileMapRules(map.rules);

    for (let j = 0; j < compiled.length; j += 1) {
      const target = compiled[j];
      let reported = false;

      // 5a. Same-position shadowing by a rule evaluated earlier at the same index
      for (let i = 0; i < j; i += 1) {
        const higher = compiled[i];
        if (higher.conditionKey === target.conditionKey) continue;
        if (subsumesAtSamePosition(higher, target)) {
          issues.push({
            map_id: map.map_id,
            map_name: map.name,
            shadowed_rule_id: target.rule.rule_id,
            shadowed_input: target.rule.input,
            shadowed_context_before: target.rule.context_before ?? "",
            shadowed_context_after: target.rule.context_after ?? "",
            shadowed_by_rule_id: higher.rule.rule_id,
            shadowed_by_input: higher.rule.input,
            shadowed_by_context_before: higher.rule.context_before ?? "",
            shadowed_by_context_after: higher.rule.context_after ?? "",
            reason: "same_position_greedy_or_specificity",
          });
          reported = true;
          break;
        }
      }

      if (reported) continue;

      // 5b. Left-to-right greedy consumption shadowing (e.g. `ch -> tʃ` consumes `h / c_`)
      for (let i = 0; i < compiled.length; i += 1) {
        if (i === j) continue;
        const consumer = compiled[i];
        if (consumer.conditionKey === target.conditionKey) continue;
        if (subsumesViaLeftConsumption(consumer, target, compiled)) {
          issues.push({
            map_id: map.map_id,
            map_name: map.name,
            shadowed_rule_id: target.rule.rule_id,
            shadowed_input: target.rule.input,
            shadowed_context_before: target.rule.context_before ?? "",
            shadowed_context_after: target.rule.context_after ?? "",
            shadowed_by_rule_id: consumer.rule.rule_id,
            shadowed_by_input: consumer.rule.input,
            shadowed_by_context_before: consumer.rule.context_before ?? "",
            shadowed_by_context_after: consumer.rule.context_after ?? "",
            reason: "left_greedy_consumption",
          });
          break;
        }
      }
    }
  }

  return issues;
}

/**
 * 6. Case sensitivity issues given `ipaGenerator`'s case-insensitive rule matching
 *    and lowercase fallback for unmatched characters.
 */
export function findCaseIssues(maps: RomanizationMap[]): CaseIssue[] {
  const issues: CaseIssue[] = [];

  for (const map of maps) {
    const parsed: NormalizedRuleInfo[] = [];
    for (let i = 0; i < map.rules.length; i += 1) {
      const info = parseNormalizedRule(map.rules[i], i);
      if (info) parsed.push(info);
    }

    const byCondition = new Map<string, NormalizedRuleInfo[]>();
    for (const info of parsed) {
      const arr = byCondition.get(info.conditionKey) ?? [];
      arr.push(info);
      byCondition.set(info.conditionKey, arr);
    }

    for (const info of parsed) {
      const hasUpperInput = info.rawInputNfc !== info.foldedInput;
      const beforeLiteralRaw = info.beforeBoundary
        ? info.rawBeforeNfc.slice(1)
        : info.rawBeforeNfc;
      const afterLiteralRaw = info.afterBoundary
        ? info.rawAfterNfc.slice(0, -1)
        : info.rawAfterNfc;
      const hasUpperContext =
        beforeLiteralRaw !== info.beforeFolded ||
        afterLiteralRaw !== info.afterFolded;

      if (!hasUpperInput && !hasUpperContext) continue;

      const sameCond = byCondition.get(info.conditionKey) ?? [];
      const caseDiffPeers = sameCond.filter(
        (peer) =>
          peer.rule.rule_id !== info.rule.rule_id &&
          (peer.rawInputNfc !== info.rawInputNfc ||
            peer.rawBeforeNfc !== info.rawBeforeNfc ||
            peer.rawAfterNfc !== info.rawAfterNfc),
      );

      let reason: CaseIssueReason;
      if (caseDiffPeers.length > 0) {
        reason = "case_collision";
      } else if (hasUpperInput) {
        reason = "uppercase_input_case_folded";
      } else {
        reason = "uppercase_context_case_folded";
      }

      const issue: CaseIssue = {
        map_id: map.map_id,
        map_name: map.name,
        rule_id: info.rule.rule_id,
        input: info.rule.input,
        context_before: info.rule.context_before ?? "",
        context_after: info.rule.context_after ?? "",
        reason,
      };
      if (caseDiffPeers.length > 0) {
        issue.colliding_rule_ids = caseDiffPeers.map((p) => p.rule.rule_id);
      }
      issues.push(issue);
    }
  }

  return issues;
}

/**
 * Runs all 6 romanization health checks (`PRD §5.2 romanization_analyze` / `T2.8`).
 */
export function analyzeRomanization(
  config: PhonologyConfig,
  options?: RomanizationAnalyzeOptions,
): RomanizationAnalysisResult {
  const maps = selectRomanizationMaps(config, options?.mapScope ?? "default");
  const unreachable_phonemes = findUnreachablePhonemes(
    config.phoneme_inventory,
    maps,
  );
  const unknown_output_phonemes = findUnknownOutputPhonemes(
    config.phoneme_inventory,
    maps,
  );
  const conflicting_rules = findConflictingRules(maps);
  const duplicate_rules = findDuplicateRules(maps);
  const shadowed_rules = findShadowedRules(maps);
  const case_issues = findCaseIssues(maps);

  const total_rules = maps.reduce((sum, m) => sum + m.rules.length, 0);
  const issue_count =
    unreachable_phonemes.length +
    unknown_output_phonemes.length +
    conflicting_rules.length +
    duplicate_rules.length +
    shadowed_rules.length +
    case_issues.length;

  return {
    map_ids: maps.map((m) => m.map_id),
    unreachable_phonemes,
    unknown_output_phonemes,
    conflicting_rules,
    duplicate_rules,
    shadowed_rules,
    case_issues,
    summary: {
      total_rules,
      issue_count,
      unreachable_phonemes: unreachable_phonemes.length,
      unknown_output_phonemes: unknown_output_phonemes.length,
      conflicting_rules: conflicting_rules.length,
      duplicate_rules: duplicate_rules.length,
      shadowed_rules: shadowed_rules.length,
      case_issues: case_issues.length,
    },
  };
}
