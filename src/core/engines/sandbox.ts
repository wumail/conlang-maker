/**
 * sandbox.ts — Phase 2 翻译沙盒引擎
 *
 * 已集成 morphologyEngine，支持全部 6 种形态类型
 * + 句法重排 reorderBySyntax()
 * + 自动屈折 autoApplyInflections()
 */
import {
  WordEntry,
  InflectionRule,
  PhonologyConfig,
  GrammarConfig,
  SyntaxConfig,
} from "../../types";
import { applyAllophony, romanizationToPhonemes } from "./ipaGenerator";
import { applyInflection, applyInflectionTypologyAware } from "./morphologyEngine";

export interface SandboxResult {
  original: string;
  conlang: string;
  ipa: string;
  gloss: string;
}

// ── 词条查找 ─────────────────────────────────────────────

const lookupByGloss = (
  glossQuery: string,
  wordsMap: Record<string, WordEntry>,
): { word: WordEntry; posId: string } | undefined => {
  const normalized = glossQuery.toLowerCase().trim();
  for (const w of Object.values(wordsMap)) {
    const sense = w.senses.find(
      (s) => s.gloss.toLowerCase().trim() === normalized,
    );
    if (sense) return { word: w, posId: sense.pos_id };
  }
  return undefined;
};

// ── 屈折应用（集成 morphologyEngine）─────────────────────

const applyInflections = (
  conWord: string,
  tags: string[],
  posId: string,
  rules: InflectionRule[],
  phonoConfig: PhonologyConfig,
  grammarConfig: GrammarConfig,
): { result: string; appliedTags: string[] } => {
  let word = conWord;
  const appliedTags: string[] = [];
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

    // 类型学感知入口优先：自动携带 grammarConfig.morphophonology_rules
    const typologyAware = applyInflectionTypologyAware(
      word,
      "",
      posId,
      rule.dimension_values,
      grammarConfig,
      phonoConfig,
    );
    const { result, applied } = typologyAware.applied
      ? typologyAware
      : applyInflection(
          word,
          rule,
          phonoConfig,
          grammarConfig.morphophonology_rules ?? [],
        );
    if (applied) {
      word = result;
      appliedTags.push(tag);
    }
  }
  return { result: word, appliedTags };
};

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

    const found = lookupByGloss(rootGloss, wordsMap);

    if (!found) {
      return {
        original: token,
        conlang: `?${rootGloss}?`,
        ipa: `/?/`,
        gloss: rootGloss,
      };
    }

    const { word: wordEntry, posId } = found;
    let conlangWord = wordEntry.con_word_romanized;

    const { result } = applyInflections(
      conlangWord,
      tags,
      posId,
      rules,
      phonology,
      grammarConfig,
    );
    conlangWord = result;

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
    };
  });
};
