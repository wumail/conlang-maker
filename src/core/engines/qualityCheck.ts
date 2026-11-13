/**
 * qualityCheck.ts — 词典质检引擎（10 维）
 *
 * 规则（PRD §2.2）：
 *   missingPos / unmappedSpelling / emptyIpa / patternMismatch / missingRequired /
 *   duplicateWord / phonotacticViolation / blacklistHit / vowelHarmonyViolation /
 *   homophonyClash / staleCompound
 *
 * 纯函数：不依赖 React / DOM / Tauri / Node FS，GUI 与 MCP 同源复用。
 */
import type {
  GrammarConfig,
  PhonologyConfig,
  RomanizationMap,
  WordEntry,
} from "../../types";
import { generateIPATraced } from "./ipaGenerator";
import { tokenizePhonemes } from "./phonemeTokenizer";
import { compileSyllableUnits, syllabifyWithUnits } from "./syllabifier";
import { matchesBlacklist } from "./wordGenerator";
import { computeComponentsDigest } from "./wordFamily";

export interface QCIssue {
  entry_id: string;
  word: string;
  rule: string;
  severity: "error" | "warning";
  message: string;
}

export type QCRuleKey =
  | "missingPos"
  | "unmappedSpelling"
  | "emptyIpa"
  | "patternMismatch"
  | "missingRequired"
  | "duplicateWord"
  | "phonotacticViolation"
  | "blacklistHit"
  | "vowelHarmonyViolation"
  | "homophonyClash"
  | "staleCompound";

/** 全部规则键（顺序即 UI 展示顺序） */
export const QC_RULE_KEYS: readonly QCRuleKey[] = [
  "missingPos",
  "unmappedSpelling",
  "emptyIpa",
  "patternMismatch",
  "missingRequired",
  "duplicateWord",
  "phonotacticViolation",
  "blacklistHit",
  "vowelHarmonyViolation",
  "homophonyClash",
  "staleCompound",
] as const;

/** 允许原样透传、不视为「未映射拼写」的字符 */
const IGNORABLE_CHARS = new Set([
  " ",
  "\t",
  "-",
  "‑",
  "–",
  "—",
  "'",
  "’",
  "·",
  ".",
  ",",
  "/",
  ":",
  ";",
  "?",
  "!",
  "(",
  ")",
  "[",
  "]",
  "\"",
  "“",
  "”",
  "…",
]);

const PROSODY_PATTERN = /[ˈˌ.\u002D\u2010-\u2015\s/\[\]]/g;

function stripProsody(text: string): string {
  return text.replace(PROSODY_PATTERN, "");
}

function defaultMapOf(phonoConfig: PhonologyConfig): RomanizationMap | undefined {
  const maps = phonoConfig.romanization_maps ?? [];
  return maps.find((map) => map.is_default) ?? maps[0];
}

export function runQualityCheck(
  words: WordEntry[],
  phonoConfig: PhonologyConfig,
  grammarConfig: GrammarConfig,
  disabledRules: QCRuleKey[],
): QCIssue[] {
  const issues: QCIssue[] = [];
  const disabled = new Set(disabledRules);
  const partsOfSpeech = grammarConfig.parts_of_speech;
  const phonotactics = phonoConfig.phonotactics;
  const inventory = phonoConfig.phoneme_inventory;
  const allPhonemes = [...inventory.consonants, ...inventory.vowels];
  const vowelSet = new Set(inventory.vowels);
  const defaultMap = defaultMapOf(phonoConfig);
  const hasRules = (defaultMap?.rules.length ?? 0) > 0;

  const structure = phonotactics.syllable_structure?.trim() ?? "";
  const units = structure ? compileSyllableUnits(structure, phonotactics.macros ?? {}, inventory) : [];

  const blacklist = phonotactics.blacklist_patterns ?? [];
  const harmony = phonotactics.vowel_harmony;
  const harmonyA = new Set(harmony?.group_a ?? []);
  const harmonyB = new Set(harmony?.group_b ?? []);

  const wordsMap: Record<string, WordEntry> = {};
  for (const word of words) wordsMap[word.entry_id] = word;

  // 词形重复统计
  const wordFreq = new Map<string, string[]>();
  for (const word of words) {
    const key = word.con_word_romanized.toLowerCase().trim();
    const bucket = wordFreq.get(key);
    if (bucket) bucket.push(word.entry_id);
    else wordFreq.set(key, [word.entry_id]);
  }

  // 同音碰撞统计（表层发音 + 词性）
  const homophoneGroups = new Map<string, { ipa: string; entries: WordEntry[] }>();

  for (const word of words) {
    // 一次前向推导同时服务 4 条依赖发音的规则，避免逐词重复计算
    const traced = hasRules ? generateIPATraced(word.con_word_romanized, phonoConfig) : null;

    // Rule 1: 缺少词性
    if (!disabled.has("missingPos")) {
      const hasEmptyPos = word.senses.some((sense) => !sense.pos_id);
      if (hasEmptyPos || word.senses.length === 0) {
        issues.push({
          entry_id: word.entry_id,
          word: word.con_word_romanized,
          rule: "missingPos",
          severity: "error",
          message: "At least one sense missing part of speech",
        });
      }
    }

    // Rule 2: 罗马化未被任何规则覆盖（基于分段轨迹，杜绝多合字母漏检与假阳性）
    if (!disabled.has("unmappedSpelling") && traced?.romanization) {
      const unmapped = traced.romanization.segments
        .filter((segment) => segment.rule_id === null)
        .map((segment) => segment.input)
        .filter((surface) => {
          const trimmed = surface.trim();
          return trimmed.length > 0 && !IGNORABLE_CHARS.has(trimmed);
        });
      if (unmapped.length > 0) {
        issues.push({
          entry_id: word.entry_id,
          word: word.con_word_romanized,
          rule: "unmappedSpelling",
          severity: "warning",
          message: `Unmapped: ${[...new Set(unmapped)].join(", ")}`,
        });
      }
    }

    // Rule 3: 空 IPA
    if (!disabled.has("emptyIpa") && !word.phonetic_ipa) {
      issues.push({
        entry_id: word.entry_id,
        word: word.con_word_romanized,
        rule: "emptyIpa",
        severity: "warning",
        message: "IPA is empty",
      });
    }

    // Rule 4: 词性词形模式不匹配
    if (!disabled.has("patternMismatch")) {
      for (const sense of word.senses) {
        const pos = partsOfSpeech.find((entry) => entry.pos_id === sense.pos_id);
        if (!pos?.word_pattern) continue;
        try {
          if (!new RegExp(pos.word_pattern).test(word.con_word_romanized)) {
            issues.push({
              entry_id: word.entry_id,
              word: word.con_word_romanized,
              rule: "patternMismatch",
              severity: "warning",
              message: `Does not match ${pos.name} pattern /${pos.word_pattern}/`,
            });
          }
        } catch {
          console.warn(`Invalid POS word_pattern regex: ${pos.word_pattern}`);
        }
      }
    }

    // Rule 5: 必填定义缺失
    if (!disabled.has("missingRequired")) {
      for (const sense of word.senses) {
        const pos = partsOfSpeech.find((entry) => entry.pos_id === sense.pos_id);
        if (pos?.requires_definition && sense.definitions.filter((d) => d.trim()).length === 0) {
          issues.push({
            entry_id: word.entry_id,
            word: word.con_word_romanized,
            rule: "missingRequired",
            severity: "error",
            message: `${pos.name} requires definition`,
          });
        }
      }
    }

    // Rule 6: 词形重复
    if (!disabled.has("duplicateWord")) {
      const key = word.con_word_romanized.toLowerCase().trim();
      const ids = wordFreq.get(key);
      if (ids && ids.length > 1 && ids[0] === word.entry_id) {
        issues.push({
          entry_id: word.entry_id,
          word: word.con_word_romanized,
          rule: "duplicateWord",
          severity: "warning",
          message: `Duplicate form (${ids.length} entries)`,
        });
      }
    }

    const phonemeString = traced?.phonemic ? stripProsody(traced.phonemic) : "";
    const phonemes = phonemeString
      ? tokenizePhonemes(phonemeString, allPhonemes)
      : [];

    // Rule 7: 音节结构违规（DP 切分失败定位到具体音素）
    if (!disabled.has("phonotacticViolation") && units.length > 0 && phonemes.length > 0) {
      const result = syllabifyWithUnits(phonemes, units, vowelSet);
      if (!result.valid) {
        const index = result.failedAtTokenIndex ?? 0;
        issues.push({
          entry_id: word.entry_id,
          word: word.con_word_romanized,
          rule: "phonotacticViolation",
          severity: "error",
          message: `Cannot syllabify at phoneme #${index} (${phonemes[index] ?? "end"}) under ${structure}`,
        });
      }
    }

    // Rule 8: 黑名单命中
    if (!disabled.has("blacklistHit") && blacklist.length > 0) {
      const hit =
        matchesBlacklist(word.con_word_romanized, blacklist) ||
        (phonemeString.length > 0 && matchesBlacklist(phonemeString, blacklist));
      if (hit) {
        issues.push({
          entry_id: word.entry_id,
          word: word.con_word_romanized,
          rule: "blacklistHit",
          severity: "error",
          message: "Matches a blacklisted phonotactic pattern",
        });
      }
    }

    // Rule 9: 元音和谐冲突
    if (!disabled.has("vowelHarmonyViolation") && harmony?.enabled && harmonyA.size > 0 && harmonyB.size > 0) {
      const tokens = phonemes.length > 0 ? phonemes : [...word.con_word_romanized];
      const groupAHits = tokens.filter((token) => harmonyA.has(token));
      const groupBHits = tokens.filter((token) => harmonyB.has(token));
      if (groupAHits.length > 0 && groupBHits.length > 0) {
        issues.push({
          entry_id: word.entry_id,
          word: word.con_word_romanized,
          rule: "vowelHarmonyViolation",
          severity: "warning",
          message: `Mixes vowel harmony groups (${[...new Set(groupAHits)].join(", ")} vs ${[...new Set(groupBHits)].join(", ")})`,
        });
      }
    }

    // 同音碰撞采集（Rule 10 的聚合在循环外完成）
    if (!disabled.has("homophonyClash")) {
      const surface = stripProsody(traced?.surface || traced?.phonemic || "");
      if (surface.length > 0) {
        for (const sense of word.senses) {
          const key = `${surface}|${sense.pos_id}`;
          const group = homophoneGroups.get(key);
          if (group) {
            group.entries.push(word);
          } else {
            homophoneGroups.set(key, { ipa: surface, entries: [word] });
          }
        }
      }
    }
  }

  // Rule 11: 复合词读音过期（上游词根词形/读音已变，摘要不一致）
  if (!disabled.has("staleCompound")) {
    for (const word of words) {
      const components = word.etymology?.components ?? [];
      if (components.length === 0) continue;
      const stored = word.etymology?.compounds_stale_digest;
      if (!stored) continue;
      const current = computeComponentsDigest(components, wordsMap);
      if (current && current !== stored) {
        issues.push({
          entry_id: word.entry_id,
          word: word.con_word_romanized,
          rule: "staleCompound",
          severity: "warning",
          message: "Component pronunciation changed since last verification",
        });
      }
    }
  }

  // Rule 10: 同音碰撞（表层发音相同 + 共享词性）
  if (!disabled.has("homophonyClash")) {
    for (const group of homophoneGroups.values()) {
      const uniqueIds = new Set(group.entries.map((entry) => entry.entry_id));
      if (uniqueIds.size < 2) continue;
      for (const entry of group.entries) {
        issues.push({
          entry_id: entry.entry_id,
          word: entry.con_word_romanized,
          rule: "homophonyClash",
          severity: "warning",
          message: `Homophone of ${uniqueIds.size} entries sharing /${group.ipa}/`,
        });
      }
    }
  }

  return issues;
}
