/**
 * sandbox.ts — Phase 2 翻译沙盒引擎
 *
 * 已集成 morphologyEngine，支持全部 6 种形态类型
 * + 句法重排 reorderBySyntax()
 * + 自动屈折 autoApplyInflections()
 */
import type {
  InflectionConflict,
  InflectionRule,
  InflectionStepTrace,
  PhonologyConfig,
  WordEntry,
} from "../../types";
import type { GrammarConfig, SyntaxConfig } from "../../types";
import type { ClauseNode } from "./phraseSandbox";
import { applyAllophony, romanizationToPhonemes } from "./ipaGenerator";
import { inflectWord } from "./morphologyEngine";

export interface SandboxResult {
  original: string;
  conlang: string;
  ipa: string;
  gloss: string;
  unresolved?: boolean;
  /** 形态推导链（词干 → 词缀 → 形态音位 → IPA，Roadmap v3 / Pillar 3） */
  inflectionSteps?: InflectionStepTrace[];
  /** 同槽位/同维度集下的并列规则冲突（Roadmap v3 / Pillar 3） */
  conflicts?: InflectionConflict[];
}

// ── 词条查找 ─────────────────────────────────────────────

function splitGlossSegments(rawGloss: string): string[] {
  const stripped = rawGloss
    .replace(/\([^)]*\)/g, " ")
    .replace(/（[^）]*）/g, " ");
  return [rawGloss, stripped]
    .flatMap((part) => part.split(/[,;，；/、|]+/))
    .map((segment) => segment.toLowerCase().trim())
    .filter(Boolean);
}

/**
 * 沙盒词条解析（三级回退）：
 *   1. 精确完整 gloss 匹配
 *   2. 复合释义分段匹配（如 "灰烬, ash" 同时命中 "灰烬" 与 "ash"）
 *   3. 本族罗马字词干精确匹配（允许直接输入词根，如 "alan"）
 */
export const lookupSandboxWord = (
  glossQuery: string,
  wordsMap: Record<string, WordEntry>,
): { word: WordEntry; posId: string; senseId: string } | undefined => {
  const normalized = glossQuery.toLowerCase().trim();
  if (!normalized) return undefined;
  const entries = Object.values(wordsMap);

  for (const w of entries) {
    const exactSense = w.senses.find(
      (s) => s.gloss.toLowerCase().trim() === normalized,
    );
    if (exactSense) {
      return { word: w, posId: exactSense.pos_id, senseId: exactSense.sense_id };
    }
  }

  for (const w of entries) {
    const segmentSense = w.senses.find((s) =>
      splitGlossSegments(s.gloss).includes(normalized),
    );
    if (segmentSense) {
      return {
        word: w,
        posId: segmentSense.pos_id,
        senseId: segmentSense.sense_id,
      };
    }
  }

  for (const w of entries) {
    if (w.con_word_romanized.toLowerCase().trim() === normalized) {
      const first = w.senses[0];
      return { word: w, posId: first?.pos_id ?? "", senseId: first?.sense_id ?? "" };
    }
  }

  return undefined;
};

// ── 屈折应用（统一形态引擎 inflectWord）──────────────────

function canonicalDimKey(dims: Record<string, string>): string {
  return JSON.stringify(
    Object.keys(dims)
      .sort()
      .map((k) => [k, dims[k]]),
  );
}

/** 规则的主特征字典：优先取首个（按规范键排序的）融合组合，否则取 dimension_values */
function primaryRuleDims(rule: InflectionRule): Record<string, string> {
  const fused = (rule.fused_dimensions ?? [])
    .filter((dict) => Object.keys(dict).length > 0)
    .sort((a, b) => canonicalDimKey(a).localeCompare(canonicalDimKey(b)));
  if (fused.length > 0) return fused[0];
  return rule.dimension_values ?? {};
}

// ── 句法重排 ─────────────────────────────────────────────

export type SyntaxRole = "S" | "V" | "O" | "Mod" | "Adp" | "Other";

export interface AnnotatedToken {
  gloss: string;
  role: SyntaxRole;
  tags: string[];
}

export function reorderBySyntax(
  tokens: AnnotatedToken[],
  syntax: SyntaxConfig,
): AnnotatedToken[] {
  const orderMap: Record<string, SyntaxRole[]> = {
    SVO: ["S", "V", "O"],
    SOV: ["S", "O", "V"],
    VSO: ["V", "S", "O"],
    VOS: ["V", "O", "S"],
    OVS: ["O", "V", "S"],
    OSV: ["O", "S", "V"],
  };

  const order = orderMap[syntax.word_order] || ["S", "V", "O"];
  const grouped: Record<string, AnnotatedToken[]> = {
    S: [],
    V: [],
    O: [],
    Mod: [],
    Adp: [],
    Other: [],
  };

  for (const t of tokens) {
    (grouped[t.role] || grouped["Other"]).push(t);
  }

  const result: AnnotatedToken[] = [];

  for (const role of order) {
    const core = grouped[role] || [];
    if (role === "S" || role === "O") {
      const adpTokens = role === "O" ? grouped["Adp"] : [];
      if (syntax.adposition_type === "preposition") {
        result.push(...adpTokens);
      }

      const mods = grouped["Mod"].filter(() => role === "O");
      if (syntax.modifier_position === "before_head") {
        result.push(...mods, ...core);
      } else {
        result.push(...core, ...mods);
      }

      if (syntax.adposition_type === "postposition") {
        result.push(...adpTokens);
      }
    } else {
      result.push(...core);
    }
  }

  result.push(...grouped["Other"]);

  return result;
}

export function autoApplyInflections(
  role: SyntaxRole,
  dimensions: GrammarConfig["inflection_dimensions"],
  posId: string,
): string[] {
  const tags: string[] = [];
  for (const dim of dimensions) {
    if (!dim.applies_to_pos.includes(posId)) continue;
    const defaultVal = dim.values[0];
    if (!defaultVal) continue;

    const dimName = dim.name.toLowerCase();
    if (dimName.includes("case") || dimName.includes("格")) {
      if (role === "S") {
        const nom = dim.values.find(
          (v) =>
            v.gloss.toLowerCase().includes("nom") ||
            v.name.toLowerCase().includes("nominat"),
        );
        if (nom) tags.push(nom.gloss || nom.name);
      } else if (role === "O") {
        const acc = dim.values.find(
          (v) =>
            v.gloss.toLowerCase().includes("acc") ||
            v.name.toLowerCase().includes("accusat"),
        );
        if (acc) tags.push(acc.gloss || acc.name);
      }
    }
  }
  return tags;
}

// ── 主处理函数 ───────────────────────────────────────────

export const processSandboxText = (
  text: string,
  wordsMap: Record<string, WordEntry>,
  grammarConfig: GrammarConfig,
  phonology: PhonologyConfig,
): SandboxResult[] => {
  const tokens = text.split(/\s+/).filter((t) => t.trim() !== "");
  const rules = grammarConfig.inflection_rules || [];

  const defaultMap =
    phonology.romanization_maps.find((m) => m.is_default) ??
    phonology.romanization_maps[0];

  return tokens.map((token) => {
    const parts = token.split("-");
    const rootGloss = parts[0];
    const tags = parts.slice(1);

    const found = lookupSandboxWord(rootGloss, wordsMap);

    if (!found) {
      return {
        original: token,
        conlang: `?${rootGloss}?`,
        ipa: `/?/`,
        gloss: rootGloss,
        unresolved: true,
      };
    }

    const { word: wordEntry, posId, senseId } = found;
    let conlangWord = wordEntry.con_word_romanized;
    let inflectionSteps: InflectionStepTrace[] | undefined;
    let conflicts: InflectionConflict[] | undefined;

    // 按标签聚合各规则的（融合）特征字典，交给统一形态引擎一次推导
    const requestedDims: Record<string, string> = {};
    let matchedAnyRule = false;
    for (const tag of tags) {
      let rule = rules.find(
        (r) =>
          r.tag.toUpperCase() === tag.toUpperCase() &&
          r.pos_id === posId &&
          !r.disabled,
      );
      if (!rule) {
        rule = rules.find(
          (r) => r.tag.toUpperCase() === tag.toUpperCase() && !r.disabled,
        );
      }
      if (!rule) continue;
      matchedAnyRule = true;
      Object.assign(requestedDims, primaryRuleDims(rule));
    }
    if (matchedAnyRule) {
      const inflected = inflectWord({
        stem: wordEntry.con_word_romanized,
        posId,
        dimensions: requestedDims,
        grammar: grammarConfig,
        phono: phonology,
        entry: wordEntry,
        senseId,
      });
      conlangWord = inflected.surface_form;
      inflectionSteps = inflected.steps;
      conflicts = inflected.conflicts;
    }

    let baseIpa: string;
    if (wordEntry.phonetic_override && wordEntry.phonetic_ipa) {
      baseIpa = wordEntry.phonetic_ipa.replace(/[\/\[\]]/g, "");
    } else if (defaultMap) {
      baseIpa = romanizationToPhonemes(conlangWord, defaultMap);
    } else {
      baseIpa = conlangWord;
    }

    const finalIpa = applyAllophony(
      baseIpa,
      phonology.allophony_rules,
      phonology.phonotactics.macros,
    );

    const glossStr =
      tags.length > 0 ? `${rootGloss}-${tags.join("-")}` : rootGloss;

    return {
      original: token,
      conlang: conlangWord,
      ipa: `/${finalIpa}/`,
      gloss: glossStr,
      ...(inflectionSteps ? { inflectionSteps } : {}),
      ...(conflicts ? { conflicts } : {}),
    };
  });
};

// ── 基于当前词库的沙盒默认示例生成 ───────────────────────

function extractPrimaryQueryToken(word: WordEntry): string {
  const raw = word.senses[0]?.gloss ?? "";
  const firstSegment = raw
    .replace(/\([^)]*\)/g, " ")
    .replace(/（[^）]*）/g, " ")
    .split(/[,;，；/、|]+/)
    .map((s) => s.trim())
    .find((s) => s.length > 0 && !/\s/.test(s));
  return firstSegment || word.con_word_romanized.trim();
}

function classifyPosRole(
  posId: string,
  grammar: GrammarConfig,
): "noun" | "verb" | "adj" | "det" | "other" {
  const pos = grammar.parts_of_speech.find((item) => item.pos_id === posId);
  if (!pos) return "other";
  const abbr = pos.gloss_abbr.trim().toLowerCase();
  const name = pos.name.toLowerCase();
  if (abbr === "n" || abbr.startsWith("n.") || name.includes("noun") || pos.name.includes("名")) {
    return "noun";
  }
  if (abbr === "v" || abbr === "vt" || abbr === "vi" || name.includes("verb") || pos.name.includes("动")) {
    return "verb";
  }
  if (abbr === "adj" || name.includes("adj") || pos.name.includes("形容")) {
    return "adj";
  }
  if (
    abbr === "det" ||
    abbr === "art" ||
    abbr === "dem" ||
    name.includes("det") ||
    pos.name.includes("限定") ||
    pos.name.includes("指示")
  ) {
    return "det";
  }
  return "other";
}

/** 从当前语言词典挑选真实词条构造默认短语句，避免空白英文占位词误导 */
export function buildSampleClauseFromLexicon(
  wordsMap: Record<string, WordEntry>,
  grammar: GrammarConfig,
  fallback: ClauseNode,
): ClauseNode {
  const words = Object.values(wordsMap).filter(
    (w) => w.con_word_romanized.trim().length > 0 && w.senses.length > 0,
  );
  if (words.length === 0) return fallback;

  const buckets: Record<"noun" | "verb" | "adj" | "det" | "other", WordEntry[]> = {
    noun: [],
    verb: [],
    adj: [],
    det: [],
    other: [],
  };
  for (const w of words) {
    const role = classifyPosRole(w.senses[0]?.pos_id ?? "", grammar);
    buckets[role].push(w);
  }

  const subjEntry = buckets.noun[0] ?? words[0];
  const objEntry =
    buckets.noun[1] ??
    words.find((w) => w.entry_id !== subjEntry.entry_id) ??
    subjEntry;
  const verbEntry =
    buckets.verb[0] ??
    words.find(
      (w) =>
        w.entry_id !== subjEntry.entry_id && w.entry_id !== objEntry.entry_id,
    ) ??
    words[0];
  const adjEntry = buckets.adj[0];
  const detEntry = buckets.det[0];

  const verbPosId = verbEntry.senses[0]?.pos_id ?? "";
  const verbRule = grammar.inflection_rules.find(
    (r) => !r.disabled && r.pos_id === verbPosId && r.tag.trim().length > 0,
  );
  const numberDim = grammar.inflection_dimensions.find(
    (d) =>
      d.name.toLowerCase().includes("number") ||
      d.name.includes("数") ||
      d.values.some((v) => ["SG", "PL"].includes(v.gloss.trim().toUpperCase())),
  );
  const defaultNum = numberDim?.values[0]?.gloss?.trim() || undefined;

  return {
    subject: {
      head: extractPrimaryQueryToken(subjEntry),
      ...(detEntry ? { determiner: extractPrimaryQueryToken(detEntry) } : {}),
      ...(adjEntry ? { adjectives: [extractPrimaryQueryToken(adjEntry)] } : {}),
      ...(defaultNum ? { number: defaultNum } : {}),
    },
    verb: {
      gloss: extractPrimaryQueryToken(verbEntry),
      tam: verbRule ? [verbRule.tag.trim()] : [],
    },
    object: {
      head: extractPrimaryQueryToken(objEntry),
      ...(defaultNum ? { number: defaultNum } : {}),
    },
    polarity: "affirmative",
  };
}

/** 从当前语言词典构造词汇标注模式的默认示例输入 */
export function buildSampleGlossInput(
  wordsMap: Record<string, WordEntry>,
  grammar: GrammarConfig,
): string {
  const sample = buildSampleClauseFromLexicon(wordsMap, grammar, {
    subject: { head: "star", number: "PL" },
    verb: { gloss: "shine", tam: ["PST"] },
    object: { head: "void" },
  });
  const subj = sample.subject.number
    ? `${sample.subject.head}-${sample.subject.number}`
    : sample.subject.head;
  const verb =
    sample.verb.tam && sample.verb.tam.length > 0
      ? `${sample.verb.gloss}-${sample.verb.tam.join("-")}`
      : sample.verb.gloss;
  const obj = sample.object?.head ?? "";
  return [subj, verb, obj].filter(Boolean).join(" ");
}
