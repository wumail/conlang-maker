/**
 * morphologyEngine.ts — 统一形态执行引擎（Roadmap v3 / Pillar 3）
 *
 * 支持 6 种形态类型：prefix, suffix, infix, circumfix, reduplication, ablaut
 * 以及条件词缀（IF/ELSE 逻辑）
 *
 * Roadmap v3 统一 6 步规则选择管线（inflectWord / generateTypedParadigm）：
 *   1. 词条不规则覆盖（irregular_overrides，entry_id + 维度精确匹配优先）
 *   2. 变位类解析（sense.inflection_class_id → word.inflection_class_id → stem_pattern）
 *   3. 音系/词干适用条件（match_regex + ConditionClause）
 *   4. 特征组合匹配（dimension_values 与 fused_dimensions 同时支持）
 *   5. 确定性排序（变位类专属度 → priority → rule_id 字典序）与冲突检测
 *   6. 词缀拼合 → applyMorphophonology → generateIPA
 *
 * 兼容层：applyInflection / generateParadigm / applyAgglutinativeChain /
 * applyFusionalInflection / applyInflectionTypologyAware 保留旧签名，
 * 其中 generateParadigm 底层委托 inflectWord，自动获得变位类与融合维度修复。
 */
import type {
  ConjugationClass,
  ConditionClause,
  GrammarConfig,
  InflectionConflict,
  InflectionDimension,
  InflectionRequestDiagnosis,
  InflectionRule,
  InflectionResult as UnifiedInflectionResult,
  InflectionStepTrace,
  IrregularOverride,
  MorphologyType,
  MorphophonologyRule,
  PhonemeInventory,
  PhonologyConfig,
  WordEntry,
} from "../../types";
import { applyMorphophonology, type MorphophonologyStep } from "./morphophonology";
import { generateIPA } from "./ipaGenerator";

// ── 类型定义 ─────────────────────────────────────────────

export interface InflectionResult {
  result: string;
  applied: boolean;
  log: string;
  stem_start?: number;
}

// ── 辅助函数 ─────────────────────────────────────────────

function endsWithPhonemeClass(
  word: string,
  cls: "vowel" | "consonant",
  inventory: PhonemeInventory,
): boolean {
  if (!word) return false;
  const pool = cls === "vowel" ? inventory.vowels : inventory.consonants;
  // 从长到短匹配（支持多字符音素如 "tʃ"）
  const sorted = [...pool].sort((a, b) => b.length - a.length);
  return sorted.some((p) => word.endsWith(p));
}

function startsWithPhonemeClass(
  word: string,
  cls: "vowel" | "consonant",
  inventory: PhonemeInventory,
): boolean {
  if (!word) return false;
  const pool = cls === "vowel" ? inventory.vowels : inventory.consonants;
  const sorted = [...pool].sort((a, b) => b.length - a.length);
  return sorted.some((p) => word.startsWith(p));
}

function resolveCondition(
  word: string,
  condition: ConditionClause,
  inventory: PhonemeInventory,
): { affix: string; matched: boolean; log: string } {
  let matched = false;
  let log = "";

  switch (condition.type) {
    case "ends_with_phoneme_class":
      matched = endsWithPhonemeClass(word, condition.class ?? "vowel", inventory);
      log = `ends_with ${condition.class}: ${matched}`;
      break;
    case "starts_with_phoneme_class":
      matched = startsWithPhonemeClass(word, condition.class ?? "vowel", inventory);
      log = `starts_with ${condition.class}: ${matched}`;
      break;
    case "matches_regex":
      matched = safeRegexTest(condition.regex ?? "", word);
      log = `regex /${condition.regex}/: ${matched}`;
      break;
  }

  return {
    affix: matched ? condition.then_affix : condition.else_affix,
    matched,
    log: `condition(${log}) → "${matched ? condition.then_affix : condition.else_affix}"`,
  };
}

/** 无效正则一律视为不匹配，绝不抛出 */
function safeRegexTest(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern).test(text);
  } catch (error) {
    console.warn(`[morphologyEngine] invalid regex "${pattern}": ${String(error)}`);
    return false;
  }
}

/** 维度字典的规范键（键排序后序列化，保证与对象键序无关） */
function canonicalDimKey(dims: Record<string, string>): string {
  return JSON.stringify(
    Object.keys(dims)
      .sort()
      .map((k) => [k, dims[k]]),
  );
}

/** sub 的每个键值都必须与 sup 一致（sub ⊆ sup） */
function dimsSubsetOf(sub: Record<string, string>, sup: Record<string, string>): boolean {
  return Object.entries(sub).every(([k, v]) => sup[k] === v);
}

function nonEmptyFusedDicts(rule: InflectionRule): Record<string, string>[] {
  return (rule.fused_dimensions ?? []).filter(
    (dict) => Object.keys(dict).length > 0,
  );
}

function glossLabelsForDims(
  grammar: GrammarConfig,
  dims: Record<string, string>,
): string {
  const keys = Object.keys(dims).sort();
  if (keys.length === 0) return "";
  return keys
    .map((k) => {
      const dim = grammar.inflection_dimensions.find((d) => d.dim_id === k);
      const val = dim?.values.find((v) => v.val_id === dims[k]);
      return (val?.gloss ?? dims[k]).replace(/\.+$/u, "");
    })
    .join(".");
}

// ── 各形态类型实现 ───────────────────────────────────────

function applyPrefix(word: string, affix: string): string {
  return affix + word;
}

function applySuffix(word: string, affix: string): string {
  return word + affix;
}

function applyInfix(
  word: string,
  positionRegex: string,
  morpheme: string,
): { result: string; log: string } {
  try {
    const regex = new RegExp(positionRegex);
    const match = regex.exec(word);
    if (match && match.index !== undefined) {
      const insertPos = match.index + match[0].length;
      const result = word.slice(0, insertPos) + morpheme + word.slice(insertPos);
      return { result, log: `infix "${morpheme}" at pos ${insertPos}` };
    }
    return { result: word + morpheme, log: `infix regex no match, appended` };
  } catch (error) {
    console.warn(
      `[morphologyEngine] invalid infix regex "${positionRegex}": ${String(error)}`,
    );
    return { result: word, log: `invalid infix regex: ${positionRegex}` };
  }
}

function applyCircumfix(
  word: string,
  prefixPart: string,
  suffixPart: string,
): string {
  return prefixPart + word + suffixPart;
}

function applyReduplication(
  word: string,
  mode: "full" | "partial_onset" | "partial_coda",
  inventory: PhonemeInventory,
): { result: string; log: string } {
  if (mode === "full") {
    return { result: word + word, log: "full reduplication" };
  }

  // 音节切分简化实现：找到第一个元音簇边界
  const vowels = new Set(inventory.vowels);

  if (mode === "partial_onset") {
    // 首音节：从开头到第一个元音（含）之后的辅音之前
    let endIdx = 0;
    let foundVowel = false;
    for (let i = 0; i < word.length; i++) {
      if (vowels.has(word[i])) {
        foundVowel = true;
        endIdx = i + 1;
      } else if (foundVowel) {
        break;
      }
    }
    if (endIdx === 0) endIdx = Math.min(2, word.length);
    const onset = word.slice(0, endIdx);
    return { result: onset + word, log: `partial onset "${onset}" + word` };
  }

  // partial_coda: 尾音节
  let startIdx = word.length;
  let foundVowel = false;
  for (let i = word.length - 1; i >= 0; i--) {
    if (vowels.has(word[i])) {
      foundVowel = true;
      startIdx = i;
    } else if (foundVowel) {
      startIdx = i + 1;
      break;
    }
  }
  if (startIdx >= word.length) startIdx = Math.max(0, word.length - 2);
  const coda = word.slice(startIdx);
  return { result: word + coda, log: `word + partial coda "${coda}"` };
}

function applyAblaut(
  word: string,
  targetVowel: string,
  replacementVowel: string,
): { result: string; log: string } {
  if (!word.includes(targetVowel)) {
    return { result: word, log: `ablaut: "${targetVowel}" not found` };
  }
  const result = word.replace(targetVowel, replacementVowel);
  return { result, log: `ablaut: "${targetVowel}" → "${replacementVowel}"` };
}

// ── 单规则应用（带推导追踪）──────────────────────────────

interface RuleApplicationTrace {
  result: string;
  applied: boolean;
  log: string;
  /** 规则主日志（类型 + 词缀，供推导步骤 label 使用） */
  typeLog: string;
  /** 该规则贡献的词干偏移（前缀 / 环缀前段长度） */
  stemStart: number;
  /** 前缀/后缀实际使用的词缀（条件分支解析后） */
  affix: string | null;
  circumfix: { prefixPart: string; suffixPart: string } | null;
  /** 命中并实际改写了表层词形的形态音位规则 */
  mpSteps: MorphophonologyStep[];
}

function applyRuleTraced(
  word: string,
  rule: InflectionRule,
  phonoConfig: PhonologyConfig,
  morphophonologyRules: readonly MorphophonologyRule[] = [],
): RuleApplicationTrace {
  const inventory = phonoConfig.phoneme_inventory;

  // 1. 检查 match_regex
  if (rule.match_regex && rule.match_regex !== ".*") {
    if (!safeRegexTest(rule.match_regex, word)) {
      return {
        result: word,
        applied: false,
        log: `regex /${rule.match_regex}/ did not match`,
        typeLog: `regex /${rule.match_regex}/ did not match`,
        stemStart: 0,
        affix: null,
        circumfix: null,
        mpSteps: [],
      };
    }
  }

  // 2. 解析条件逻辑
  let effectiveAffix = rule.affix;
  let conditionLog = "";
  if (rule.condition) {
    const condResult = resolveCondition(word, rule.condition, inventory);
    effectiveAffix = condResult.affix;
    conditionLog = condResult.log;
  }

  // 3. 按 type 分支应用
  let result = word;
  /** 带 `+` 词素边界的中间串（仅前缀/后缀/环缀能精确构造） */
  let intermediate: string | null = null;
  let typeLog = "";
  let stemStart = 0;
  let affixUsed: string | null = null;
  let circumfixUsed: { prefixPart: string; suffixPart: string } | null = null;

  const ruleType: MorphologyType = rule.type;

  switch (ruleType) {
    case "prefix":
      result = applyPrefix(word, effectiveAffix);
      intermediate = `${effectiveAffix}+${word}`;
      stemStart = Array.from(effectiveAffix).length;
      typeLog = `prefix "${effectiveAffix}"`;
      affixUsed = effectiveAffix;
      break;

    case "suffix":
      result = applySuffix(word, effectiveAffix);
      intermediate = `${word}+${effectiveAffix}`;
      typeLog = `suffix "${effectiveAffix}"`;
      affixUsed = effectiveAffix;
      break;

    case "infix": {
      const cfg = rule.infix_config;
      if (cfg) {
        const infResult = applyInfix(word, cfg.position_regex, cfg.morpheme);
        result = infResult.result;
        typeLog = infResult.log;
      } else {
        typeLog = "infix: missing config";
      }
      break;
    }

    case "circumfix": {
      const cfg = rule.circumfix_config;
      if (cfg) {
        result = applyCircumfix(word, cfg.prefix_part, cfg.suffix_part);
        intermediate = `${cfg.prefix_part}+${word}+${cfg.suffix_part}`;
        stemStart = Array.from(cfg.prefix_part).length;
        typeLog = `circumfix "${cfg.prefix_part}-...-${cfg.suffix_part}"`;
        circumfixUsed = { prefixPart: cfg.prefix_part, suffixPart: cfg.suffix_part };
      } else {
        typeLog = "circumfix: missing config";
      }
      break;
    }

    case "reduplication": {
      const cfg = rule.reduplication_config;
      const mode = cfg?.mode ?? "full";
      const redResult = applyReduplication(word, mode, inventory);
      result = redResult.result;
      typeLog = redResult.log;
      break;
    }

    case "ablaut": {
      const cfg = rule.ablaut_config;
      if (cfg) {
        const abResult = applyAblaut(
          word,
          cfg.target_vowel,
          cfg.replacement_vowel,
        );
        result = abResult.result;
        typeLog = abResult.log;
      } else {
        typeLog = "ablaut: missing config";
      }
      break;
    }
  }

  const logParts = [typeLog];
  if (conditionLog) logParts.unshift(conditionLog);

  // 跨词素边界的共时形态音位调整（无规则时零开销）
  let mpSteps: MorphophonologyStep[] = [];
  if (intermediate && morphophonologyRules.length > 0) {
    const adjusted = applyMorphophonology(intermediate, morphophonologyRules, phonoConfig);
    if (adjusted.surface !== result) {
      logParts.push(
        adjusted.steps.map((step) => step.description || step.ruleId).join(" → "),
      );
      result = adjusted.surface;
      mpSteps = adjusted.steps;
    }
  }

  return {
    result,
    applied: true,
    log: logParts.join(" | "),
    typeLog,
    stemStart,
    affix: affixUsed,
    circumfix: circumfixUsed,
    mpSteps,
  };
}

// ── 主引擎函数（旧签名兼容层）────────────────────────────

export function applyInflection(
  word: string,
  rule: InflectionRule,
  phonoConfig: PhonologyConfig,
  morphophonologyRules: readonly MorphophonologyRule[] = [],
): InflectionResult {
  const traced = applyRuleTraced(word, rule, phonoConfig, morphophonologyRules);
  return {
    result: traced.result,
    applied: traced.applied,
    log: traced.log,
    ...(traced.stemStart > 0 ? { stem_start: traced.stemStart } : {}),
  };
}

// ── Roadmap v3 / Pillar 3：统一 6 步形态执行管线 ──────────

/**
 * 解析词条（或义项）的屈折变位类。
 * 优先级：sense.inflection_class_id → entry.inflection_class_id →
 * ConjugationClass.applies_to_pos === posId 且 stem_pattern 匹配词条词形 → null。
 */
export function resolveEntryConjugationClass(
  entry: WordEntry | null | undefined,
  posId: string,
  classes: ConjugationClass[],
  senseId?: string,
): { classId: string | null; source: "sense" | "word" | "stem_pattern" | "none" } {
  const known = new Set(classes.map((c) => c.class_id));

  if (entry && senseId) {
    const sense = entry.senses.find((s) => s.sense_id === senseId);
    const senseClassId = sense?.inflection_class_id;
    if (senseClassId && known.has(senseClassId)) {
      return { classId: senseClassId, source: "sense" };
    }
  }

  const wordClassId = entry?.inflection_class_id;
  if (wordClassId && known.has(wordClassId)) {
    return { classId: wordClassId, source: "word" };
  }

  const stem = entry?.con_word_romanized ?? "";
  if (stem) {
    const sorted = [...classes]
      .filter((c) => c.applies_to_pos === posId && c.stem_pattern.trim().length > 0)
      .sort((a, b) => a.class_id.localeCompare(b.class_id));
    for (const cls of sorted) {
      if (safeRegexTest(cls.stem_pattern, stem)) {
        return { classId: cls.class_id, source: "stem_pattern" };
      }
    }
  }

  return { classId: null, source: "none" };
}

/**
 * 返回规则命中的特征字典（dimension_values 或某个 fused_dimensions 组合）；
 * 未命中返回 null。空特征且无融合字典的规则仅匹配空请求（保持旧范式枚举语义）。
 */
function matchFeatureDict(
  rule: InflectionRule,
  requestedDims: Record<string, string>,
): Record<string, string> | null {
  const fused = nonEmptyFusedDicts(rule).sort((a, b) =>
    canonicalDimKey(a).localeCompare(canonicalDimKey(b)),
  );
  const dims = rule.dimension_values ?? {};
  const dimsNonEmpty = Object.keys(dims).length > 0;

  if (dimsNonEmpty && dimsSubsetOf(dims, requestedDims)) {
    return dims;
  }
  for (const dict of fused) {
    if (dimsSubsetOf(dict, requestedDims)) {
      return dict;
    }
  }
  if (!dimsNonEmpty && fused.length === 0 && Object.keys(requestedDims).length === 0) {
    return dims;
  }
  return null;
}

/** 特征组合匹配：dimension_values（非空且全部键值匹配）或任一非空 fused_dimensions 组合全部键值匹配 */
export function ruleMatchesFeatures(
  rule: InflectionRule,
  requestedDims: Record<string, string>,
): boolean {
  return matchFeatureDict(rule, requestedDims) !== null;
}

/**
 * 请求特征完整性诊断：缺失的必填维度（AffixSlot.is_obligatory 且适用于该词性）、
 * 解析出的变位类及来源。
 */
export function diagnoseInflectionRequest(
  posId: string,
  requestedDims: Record<string, string>,
  grammar: GrammarConfig,
  entry?: WordEntry | null,
  senseId?: string,
): InflectionRequestDiagnosis {
  const classResolution = resolveEntryConjugationClass(
    entry,
    posId,
    grammar.conjugation_classes,
    senseId,
  );
  const applicableDimIds = new Set(
    grammar.inflection_dimensions
      .filter((dim) => dim.applies_to_pos.includes(posId))
      .map((dim) => dim.dim_id),
  );
  const missing = [
    ...new Set(
      grammar.affix_slots
        .filter(
          (slot) => slot.is_obligatory && applicableDimIds.has(slot.dimension_id),
        )
        .map((slot) => slot.dimension_id)
        .filter((dimId) => requestedDims[dimId] === undefined),
    ),
  ].sort();

  return {
    pos_id: posId,
    provided_dimensions: { ...requestedDims },
    missing_obligatory_dimensions: missing,
    resolved_class_id: classResolution.classId,
    resolved_class_source: classResolution.source,
  };
}

/** 不规则覆盖择优：精确匹配优先，其次维度更多（更具体），最后按键字典序兜底 */
export function findBestIrregularOverride(
  overrides: readonly IrregularOverride[],
  entryId: string,
  requestedDims: Record<string, string>,
): IrregularOverride | undefined {
  const matching = overrides.filter(
    (ov) =>
      ov.entry_id === entryId && dimsSubsetOf(ov.dimension_values, requestedDims),
  );
  if (matching.length === 0) return undefined;
  const requestKey = canonicalDimKey(requestedDims);
  return [...matching].sort((a, b) => {
    const exactA = canonicalDimKey(a.dimension_values) === requestKey ? 0 : 1;
    const exactB = canonicalDimKey(b.dimension_values) === requestKey ? 0 : 1;
    if (exactA !== exactB) return exactA - exactB;
    const lenA = Object.keys(a.dimension_values).length;
    const lenB = Object.keys(b.dimension_values).length;
    if (lenA !== lenB) return lenB - lenA;
    return canonicalDimKey(a.dimension_values).localeCompare(
      canonicalDimKey(b.dimension_values),
    );
  })[0];
}

interface RuleCandidate {
  rule: InflectionRule;
  /** 2 = 解析变位类专属规则；1 = 通用无类规则 */
  specificity: number;
  /** 命中的特征字典（dimension_values 或融合组合） */
  matchedDims: Record<string, string>;
  conflictKey: string;
  priority: number;
}

/**
 * 全应用唯一权威形态推导入口（PRD §2 Pillar 3 六步管线）。
 */
export function inflectWord(params: {
  stem: string;
  posId: string;
  dimensions: Record<string, string>;
  grammar: GrammarConfig;
  phono: PhonologyConfig;
  entry?: WordEntry | null;
  senseId?: string;
}): UnifiedInflectionResult {
  const { stem, posId, dimensions, grammar, phono } = params;
  const entry = params.entry ?? null;
  const steps: InflectionStepTrace[] = [];
  const conflicts: InflectionConflict[] = [];

  const diagnosis = diagnoseInflectionRequest(
    posId,
    dimensions,
    grammar,
    entry,
    params.senseId,
  );
  const mpRules = grammar.morphophonology_rules ?? [];

  // Step 1：词条不规则覆盖（entry_id + 维度精确匹配优先）
  if (entry) {
    const irregular = findBestIrregularOverride(
      grammar.irregular_overrides,
      entry.entry_id,
      dimensions,
    );
    if (irregular) {
      steps.push({
        stage: "irregular",
        label: `irregular override → "${irregular.surface_form}"`,
        before: stem,
        after: irregular.surface_form,
      });
      const ipa = generateIPA(irregular.surface_form, phono, {
        stem_start: irregular.stem_start,
      });
      steps.push({
        stage: "ipa",
        label: "IPA",
        before: irregular.surface_form,
        after: ipa.phonemic,
      });
      return {
        surface_form: irregular.surface_form,
        morpheme_break: irregular.surface_form,
        gloss_labels: glossLabelsForDims(grammar, dimensions),
        phonetic_ipa: ipa.phonemic,
        stem_start: irregular.stem_start ?? 0,
        applied_rule_ids: [],
        used_irregular: true,
        diagnosis,
        conflicts,
        steps,
      };
    }
  }

  // Step 2：变位类解析（sense → word → stem_pattern）
  const classResolution = resolveEntryConjugationClass(
    entry,
    posId,
    grammar.conjugation_classes,
    params.senseId,
  );
  const classId = classResolution.classId;
  if (classId) {
    steps.push({
      stage: "class_select",
      label: `conjugation class ${classId} (${classResolution.source})`,
      before: stem,
      after: stem,
    });
  }

  // Step 3 + 4：候选收集（词性、启用、变位类门控、match_regex、特征匹配）
  const classByRuleId = new Map<string, string>();
  for (const cls of grammar.conjugation_classes) {
    for (const rid of cls.rule_ids) {
      classByRuleId.set(rid, cls.class_id);
    }
  }
  const candidates: RuleCandidate[] = [];
  for (const rule of grammar.inflection_rules) {
    if (rule.pos_id !== posId || rule.disabled) continue;
    const ownedClass = rule.conjugation_class_id ?? classByRuleId.get(rule.rule_id);
    if (ownedClass && ownedClass !== classId) continue;
    const specificity = ownedClass ? 2 : 1;
    if (
      rule.match_regex &&
      rule.match_regex !== ".*" &&
      !safeRegexTest(rule.match_regex, stem)
    ) {
      continue;
    }
    const matchedDims = matchFeatureDict(rule, dimensions);
    if (!matchedDims) continue;
    candidates.push({
      rule,
      specificity,
      matchedDims,
      conflictKey: rule.slot_id ?? canonicalDimKey(matchedDims),
      priority: rule.priority ?? 0,
    });
  }

  // Step 5：确定性排序（变位类专属度 → priority 升序 → rule_id 字典序）
  candidates.sort(
    (a, b) =>
      b.specificity - a.specificity ||
      a.priority - b.priority ||
      a.rule.rule_id.localeCompare(b.rule.rule_id),
  );

  // 冲突检测：同槽位/同维度集下最高优先级并列 ≥ 2 条规则
  const groups = new Map<string, RuleCandidate[]>();
  for (const cand of candidates) {
    const group = groups.get(cand.conflictKey);
    if (group) group.push(cand);
    else groups.set(cand.conflictKey, [cand]);
  }
  for (const group of groups.values()) {
    const topSpecificity = Math.max(...group.map((c) => c.specificity));
    const tier = group.filter((c) => c.specificity === topSpecificity);
    const minPriority = Math.min(...tier.map((c) => c.priority));
    const tied = tier.filter((c) => c.priority === minPriority);
    if (tied.length >= 2) {
      conflicts.push({
        dimension_key: canonicalDimKey(tied[0].matchedDims),
        slot_id: tied[0].rule.slot_id,
        candidate_rule_ids: tied.map((c) => c.rule.rule_id),
        winner_rule_id: tied[0].rule.rule_id,
        reason: `${tied.length} rules tied at class-specificity ${topSpecificity} and priority ${minPriority}; winner chosen by rule_id lexicographic order`,
      });
    }
  }

  // 贪心选择：按确定性排序依次采纳；特征维度与已选规则重叠的候选让位
  const selected: RuleCandidate[] = [];
  const claimedDims = new Set<string>();
  for (const cand of candidates) {
    const keys = Object.keys(cand.matchedDims);
    if (keys.some((k) => claimedDims.has(k))) continue;
    selected.push(cand);
    for (const k of keys) claimedDims.add(k);
  }

  // 应用顺序：槽位位置（无槽位视为 0，前缀槽位为负数先应用）→ 采纳顺序
  const slotPosition = (rule: InflectionRule): number =>
    grammar.affix_slots.find((slot) => slot.slot_id === rule.slot_id)?.position ?? 0;
  const ordered = [...selected].sort(
    (a, b) => slotPosition(a.rule) - slotPosition(b.rule),
  );

  // Step 6：词缀拼合 → applyMorphophonology → generateIPA
  let current = stem;
  const breakParts: string[] = [stem];
  let hasUnboundedMorph = false;
  let stemStartTotal = 0;
  /** 仅统计**真正生效**的规则所覆盖的特征维度（供 gloss_labels 使用） */
  const appliedDims: Record<string, string> = {};
  /** 仅记录**真正生效**的规则（多槽位下被先前词缀作废的规则不记） */
  const appliedRuleIds: string[] = [];

  for (const cand of ordered) {
    const before = current;
    const traced = applyRuleTraced(current, cand.rule, phono, mpRules);
    if (!traced.applied) {
      // 多槽位场景：先前词缀已改写表层词形，导致该规则的 match_regex 不再成立。
      // 未生效的规则绝不能被记入 applied_rule_ids / steps / gloss_labels。
      continue;
    }
    steps.push({
      stage: "affix",
      rule_id: cand.rule.rule_id,
      label: traced.typeLog,
      before,
      after: traced.result,
    });
    for (const mpStep of traced.mpSteps) {
      steps.push({
        stage: "morphophonology",
        rule_id: mpStep.ruleId,
        label: mpStep.description || mpStep.ruleId,
        before: mpStep.before,
        after: mpStep.after,
      });
    }
    switch (cand.rule.type) {
      case "prefix":
        if (traced.affix) breakParts.unshift(traced.affix);
        break;
      case "suffix":
        if (traced.affix) breakParts.push(traced.affix);
        break;
      case "circumfix":
        if (traced.circumfix) {
          breakParts.unshift(traced.circumfix.prefixPart);
          breakParts.push(traced.circumfix.suffixPart);
        }
        break;
      default:
        hasUnboundedMorph = true;
        break;
    }
    Object.assign(appliedDims, cand.matchedDims);
    appliedRuleIds.push(cand.rule.rule_id);
    stemStartTotal += traced.stemStart;
    current = traced.result;
  }

  const morphemeBreak = hasUnboundedMorph ? current : breakParts.join("+");
  const ipa = generateIPA(current, phono, { stem_start: stemStartTotal });
  steps.push({ stage: "ipa", label: "IPA", before: current, after: ipa.phonemic });

  const glossLabels =
    Object.keys(appliedDims).length > 0
      ? glossLabelsForDims(grammar, appliedDims)
      : glossLabelsForDims(grammar, dimensions);

  return {
    surface_form: current,
    morpheme_break: morphemeBreak,
    gloss_labels: glossLabels,
    phonetic_ipa: ipa.phonemic,
    stem_start: stemStartTotal,
    applied_rule_ids: appliedRuleIds,
    used_irregular: false,
    diagnosis,
    conflicts,
    steps,
  };
}

/**
 * 按给定维度列表枚举全部特征组合，逐格调用 inflectWord 生成完整范式。
 * 词条级不规则覆盖若落在枚举组合之外，会补充为独立单元格。
 */
export function generateTypedParadigm(params: {
  stem: string;
  posId: string;
  dimensionIds: string[];
  grammar: GrammarConfig;
  phono: PhonologyConfig;
  entry?: WordEntry | null;
  senseId?: string;
}): Array<{ dimensions: Record<string, string>; result: UnifiedInflectionResult }> {
  const { stem, posId, grammar, phono } = params;
  const entry = params.entry ?? null;

  const seenDimIds = new Set<string>();
  const dims: InflectionDimension[] = [];
  for (const dimId of params.dimensionIds) {
    if (seenDimIds.has(dimId)) continue;
    seenDimIds.add(dimId);
    const dim = grammar.inflection_dimensions.find((d) => d.dim_id === dimId);
    if (dim && dim.applies_to_pos.includes(posId) && dim.values.length > 0) {
      dims.push(dim);
    }
  }

  let combos: Record<string, string>[] = [{}];
  for (const dim of dims) {
    combos = combos.flatMap((combo) =>
      dim.values.map((val) => ({ ...combo, [dim.dim_id]: val.val_id })),
    );
  }

  const results: Array<{
    dimensions: Record<string, string>;
    result: UnifiedInflectionResult;
  }> = [];
  const seenKeys = new Set<string>();
  const pushCell = (dimsRequest: Record<string, string>): void => {
    const key = canonicalDimKey(dimsRequest);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    results.push({
      dimensions: dimsRequest,
      result: inflectWord({
        stem,
        posId,
        dimensions: dimsRequest,
        grammar,
        phono,
        entry,
        senseId: params.senseId,
      }),
    });
  };

  for (const combo of combos) {
    pushCell(combo);
  }

  // 词条级不规则覆盖：未被任何枚举组合覆盖时补充为独立单元格
  if (entry) {
    const extras = grammar.irregular_overrides
      .filter((ov) => ov.entry_id === entry.entry_id)
      .filter(
        (ov) => !combos.some((combo) => dimsSubsetOf(ov.dimension_values, combo)),
      )
      .sort((a, b) =>
        canonicalDimKey(a.dimension_values).localeCompare(
          canonicalDimKey(b.dimension_values),
        ),
      );
    for (const ov of extras) {
      pushCell(ov.dimension_values);
    }
  }

  return results;
}

// ── 旧签名范式生成（底层委托 inflectWord）────────────────

function buildStubEntry(entryId: string, stem: string, posId: string): WordEntry {
  return {
    entry_id: entryId,
    language_id: "",
    con_word_romanized: stem,
    phonetic_ipa: "",
    phonetic_override: false,
    senses: [
      {
        sense_id: `${entryId}__stub`,
        pos_id: posId,
        gloss: "",
        definitions: [],
        examples: [],
      },
    ],
    etymology: {
      origin_type: "a_priori",
      parent_entry_id: null,
      source_language_id: null,
      applied_sound_changes: [],
      semantic_shift_note: "",
    },
    metadata: { tags: [], created_at: "", updated_at: "" },
  };
}

function legacyLogOf(result: UnifiedInflectionResult): string {
  if (result.used_irregular) {
    return `irregular override -> "${result.surface_form}"`;
  }
  const affixSteps = result.steps.filter((step) => step.stage === "affix");
  if (affixSteps.length === 0) return "";
  return affixSteps.map((step) => step.label).join(" → ");
}

/**
 * 对单个词根生成所有维度组合的屈折形式范式表（旧签名兼容层）。
 *
 * 带 context 时底层委托 inflectWord：自动获得变位类解析、融合维度展开、
 * 显式优先级与冲突检测；调换 inflection_rules 数组顺序输出不变。
 *
 * `context.entry` / `context.senseId` 为可选扩展（100% 向后兼容）：
 * 传入后底层使用**真实词条**（含 `sense.inflection_class_id`）而非空壳词条，
 * 从而使范式与 `inflectWord` / `gram_inflect` 的输出完全一致。
 */
export function generateParadigm(
  word: string,
  posId: string,
  rules: InflectionRule[],
  phonoConfig: PhonologyConfig,
  context?: {
    entryId: string;
    grammar: GrammarConfig;
    /** 真实词条；缺省时退回 `buildStubEntry` 兼容旧行为 */
    entry?: WordEntry;
    /** 显式义项 ID；配合 `entry` 解析义项级 `inflection_class_id` */
    senseId?: string;
  },
): {
  dimensionValues: Record<string, string>;
  tag: string;
  result: string;
  log: string;
  stem_start?: number;
}[] {
  // 无 context 的旧路径：直接逐规则应用（保持旧行为）
  if (!context) {
    const posRules = rules.filter((r) => r.pos_id === posId && !r.disabled);
    return posRules.map((rule) => {
      const { result, log, stem_start } = applyInflection(word, rule, phonoConfig);
      return {
        dimensionValues: rule.dimension_values,
        tag: rule.tag,
        result,
        log,
        ...(stem_start === undefined ? {} : { stem_start }),
      };
    });
  }

  const grammar: GrammarConfig = { ...context.grammar, inflection_rules: rules };
  const entry: WordEntry | null =
    context.entry ?? (context.entryId ? buildStubEntry(context.entryId, word, posId) : null);
  // 不规则覆盖必须与 inflectWord 内部使用同一个 entry_id，避免真实词条与 context.entryId 漂移
  const entryId = entry?.entry_id ?? context.entryId;

  // 确定性枚举：按 rule_id 排序；融合规则按每个融合组合展开为独立单元格
  const sorted = [...rules]
    .filter((r) => r.pos_id === posId && !r.disabled)
    .sort((a, b) => a.rule_id.localeCompare(b.rule_id));

  const cells: {
    dimensionValues: Record<string, string>;
    tag: string;
    result: string;
    log: string;
    stem_start?: number;
  }[] = [];
  const seenKeys = new Set<string>();

  for (const rule of sorted) {
    const dictList = nonEmptyFusedDicts(rule).sort((a, b) =>
      canonicalDimKey(a).localeCompare(canonicalDimKey(b)),
    );
    const combos = dictList.length > 0 ? dictList : [rule.dimension_values];
    for (const dims of combos) {
      const key = canonicalDimKey(dims);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const inflected = inflectWord({
        stem: word,
        posId,
        dimensions: dims,
        grammar,
        phono: phonoConfig,
        entry,
        senseId: context.senseId,
      });
      const winnerId = inflected.applied_rule_ids[0];
      const winner = winnerId ? rules.find((r) => r.rule_id === winnerId) : undefined;
      cells.push({
        dimensionValues: dims,
        tag: winner?.tag ?? rule.tag,
        result: inflected.surface_form,
        log: legacyLogOf(inflected),
        ...(inflected.stem_start > 0 ? { stem_start: inflected.stem_start } : {}),
      });
    }
  }

  // 不规则覆盖合并（保持旧行为：未被覆盖的覆盖形式补为独立行）
  const dimensions = grammar.inflection_dimensions.filter(
    (dimension) => dimension.applies_to_pos.includes(posId),
  );
  const dimensionIds = new Set(dimensions.map((dimension) => dimension.dim_id));
  const overrides = grammar.irregular_overrides
    .filter(
      (form) =>
        form.entry_id === entryId &&
        (grammar.inflection_dimensions.length === 0 ||
          Object.keys(form.dimension_values).every((id) => dimensionIds.has(id))),
    )
    .sort((a, b) =>
      canonicalDimKey(a.dimension_values).localeCompare(
        canonicalDimKey(b.dimension_values),
      ),
    );
  const cellsByKey = new Map(
    cells.map((cell) => [canonicalDimKey(cell.dimensionValues), cell]),
  );
  for (const form of overrides) {
    const covered = cells.some((cell) =>
      Object.entries(form.dimension_values).every(
        ([dimension, value]) => cell.dimensionValues[dimension] === value,
      ),
    );
    const key = canonicalDimKey(form.dimension_values);
    if (covered || cellsByKey.has(key)) continue;
    const tag = dimensions
      .map((dimension) =>
        dimension.values.find(
          (value) => value.val_id === form.dimension_values[dimension.dim_id],
        )?.gloss?.replace(/\.+$/u, ""),
      )
      .filter(Boolean)
      .join(".");
    cellsByKey.set(key, {
      dimensionValues: form.dimension_values,
      tag,
      result: form.surface_form,
      log: "",
      ...(form.stem_start === undefined ? {} : { stem_start: form.stem_start }),
    });
  }

  return Array.from(cellsByKey.values()).map((cell) => {
    const form = findBestIrregularOverride(overrides, entryId, cell.dimensionValues);
    if (!form) return cell;
    return {
      ...cell,
      result: form.surface_form,
      log: `irregular override -> "${form.surface_form}"`,
      stem_start: form.stem_start,
    };
  });
}

// ── 类型学感知引擎 ───────────────────────────────────────

/**
 * 黏着语：按 affix_slot 顺序依次应用词缀
 *
 * 找到每个槽位对应的规则，按 position 排序（负数先，正数后），
 * 依次叠加到词根上。
 */
export function applyAgglutinativeChain(
  word: string,
  posId: string,
  dimensionValues: Record<string, string>,
  grammarConfig: GrammarConfig,
  phonoConfig: PhonologyConfig,
): InflectionResult {
  const slots = [...grammarConfig.affix_slots].sort(
    (a, b) => a.position - b.position,
  );
  const rules = grammarConfig.inflection_rules.filter(
    (r) => r.pos_id === posId && !r.disabled,
  );

  let current = word;
  const logs: string[] = [];
  let anyApplied = false;
  let stemStart = 0;

  for (const slot of slots) {
    // 找到绑定到此槽位且匹配维度值的规则
    const slotRule = rules.find(
      (r) =>
        r.slot_id === slot.slot_id &&
        dimensionValues[slot.dimension_id] &&
        r.dimension_values[slot.dimension_id] ===
          dimensionValues[slot.dimension_id],
    );

    if (!slotRule) {
      if (slot.is_obligatory) {
        logs.push(`slot[${slot.label || slot.slot_id}]: no rule (obligatory)`);
      }
      continue;
    }

    const { result, applied, log, stem_start } = applyInflection(
      current,
      slotRule,
      phonoConfig,
      grammarConfig.morphophonology_rules ?? [],
    );
    if (applied) {
      stemStart += stem_start ?? 0;
      current = result;
      anyApplied = true;
      logs.push(`slot[${slot.label || slot.slot_id}]: ${log}`);
    }
  }

  return {
    result: current,
    applied: anyApplied,
    log: logs.length > 0 ? logs.join(" → ") : "no slots matched",
    ...(stemStart > 0 ? { stem_start: stemStart } : {}),
  };
}

/**
 * 屈折语：优先不规则覆盖，其次按变位类查找
 */
export function applyFusionalInflection(
  word: string,
  entryId: string,
  posId: string,
  dimensionValues: Record<string, string>,
  grammarConfig: GrammarConfig,
  phonoConfig: PhonologyConfig,
): InflectionResult {
  // 1. 检查不规则覆盖
  const irregular = findBestIrregularOverride(
    grammarConfig.irregular_overrides,
    entryId,
    dimensionValues,
  );
  if (irregular) {
    return {
      result: irregular.surface_form,
      applied: true,
      log: `irregular override → "${irregular.surface_form}"`,
      ...(irregular.stem_start === undefined ? {} : { stem_start: irregular.stem_start }),
    };
  }

  // 2. 查找匹配的规则（可选按变位类过滤）
  const rules = grammarConfig.inflection_rules.filter(
    (r) => r.pos_id === posId && !r.disabled,
  );

  // 尝试精确匹配维度值
  const exactRule = rules.find((r) =>
    Object.entries(dimensionValues).every(
      ([k, v]) => r.dimension_values[k] === v,
    ),
  );

  if (exactRule) {
    const result = applyInflection(
      word,
      exactRule,
      phonoConfig,
      grammarConfig.morphophonology_rules ?? [],
    );
    return { ...result, log: `fusional: ${result.log}` };
  }

  return { result: word, applied: false, log: "fusional: no matching rule" };
}

/**
 * 类型学感知的屈折应用入口
 *
 * 根据 grammarConfig.typology.morphological_type 分发到不同的处理路径。
 */
export function applyInflectionTypologyAware(
  word: string,
  entryId: string,
  posId: string,
  dimensionValues: Record<string, string>,
  grammarConfig: GrammarConfig,
  phonoConfig: PhonologyConfig,
): InflectionResult {
  const morphType = grammarConfig.typology.morphological_type;

  switch (morphType) {
    case "isolating": {
      // 孤立语：仅在有明确规则时应用（规则是可选的）
      const rules = grammarConfig.inflection_rules.filter(
        (r) => r.pos_id === posId && !r.disabled,
      );
      const rule = rules.find((r) =>
        Object.entries(dimensionValues).every(
          ([k, v]) => r.dimension_values[k] === v,
        ),
      );
      if (rule) {
        return applyInflection(
          word,
          rule,
          phonoConfig,
          grammarConfig.morphophonology_rules ?? [],
        );
      }
      return {
        result: word,
        applied: false,
        log: "isolating: no inflection (expected)",
      };
    }

    case "agglutinative":
      return applyAgglutinativeChain(
        word,
        posId,
        dimensionValues,
        grammarConfig,
        phonoConfig,
      );

    case "fusional":
      return applyFusionalInflection(
        word,
        entryId,
        posId,
        dimensionValues,
        grammarConfig,
        phonoConfig,
      );

    case "polysynthetic":
      // 多式综合语：类似黏着语但支持更多槽位链接
      return applyAgglutinativeChain(
        word,
        posId,
        dimensionValues,
        grammarConfig,
        phonoConfig,
      );

    default: {
      // 回退到标准行为
      const rule = grammarConfig.inflection_rules.find(
        (r) =>
          r.pos_id === posId &&
          !r.disabled &&
          Object.entries(dimensionValues).every(
            ([k, v]) => r.dimension_values[k] === v,
          ),
      );
      if (rule) {
        return applyInflection(
          word,
          rule,
          phonoConfig,
          grammarConfig.morphophonology_rules ?? [],
        );
      }
      return { result: word, applied: false, log: "no matching rule" };
    }
  }
}
