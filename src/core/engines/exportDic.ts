/**
 * Hunspell .dic / .aff 纯文本生成模块（不含 DOM 下载依赖）
 *
 * Roadmap v3 / Pillar 3：改用统一形态引擎 generateTypedParadigm 为每个词条
 * 展开全部屈折词形（覆盖前缀、中缀、环缀、变位类与不规则词形），去重后输出。
 */
import type {
  GrammarConfig,
  InflectionDimension,
  InflectionRule,
  PhonologyConfig,
  WordEntry,
} from "../../types";
import { generateTypedParadigm } from "./morphologyEngine";

/**
 * 生成 .aff 文件内容（最简版本）
 * Hunspell 至少需要一个 .aff 文件，即使为空也要有 SET 行
 */
export function generateAff(langName: string): string {
  return [`# Affix file for ${langName}`, "SET UTF-8", ""].join("\n");
}

/**
 * 生成 .dic 文件内容（完整语法配置版）
 *
 * 以每个义项的词性为入口，枚举该词性全部屈折维度的特征组合，
 * 逐格调用 generateTypedParadigm（含词条级不规则覆盖与变位类解析），
 * 与词条原形合并去重后按字典序输出。
 */
export function generateDicFromGrammar(
  words: WordEntry[],
  grammar: GrammarConfig,
  phonoConfig?: PhonologyConfig,
): string {
  const allForms = new Set<string>();

  for (const w of words) {
    const base = w.con_word_romanized;
    if (!base) continue;
    allForms.add(base);

    if (!phonoConfig) continue;
    for (const sense of w.senses) {
      if (!sense.pos_id) continue;
      const dimensionIds = grammar.inflection_dimensions
        .filter((dim) => dim.applies_to_pos.includes(sense.pos_id))
        .map((dim) => dim.dim_id)
        .sort();
      const cells = generateTypedParadigm({
        stem: base,
        posId: sense.pos_id,
        dimensionIds,
        grammar,
        phono: phonoConfig,
        entry: w,
        senseId: sense.sense_id,
      });
      for (const cell of cells) {
        if (cell.result.surface_form) allForms.add(cell.result.surface_form);
      }
    }
  }

  const sorted = [...allForms].sort();
  return [String(sorted.length), ...sorted].join("\n");
}

/**
 * 由规则列表推断最小语法配置：把规则 dimension_values / fused_dimensions
 * 中出现过的维度值收编为伪维度定义，使旧签名调用方也能走统一范式展开。
 */
function pseudoGrammarFromRules(rules: InflectionRule[]): GrammarConfig {
  const dimValues = new Map<string, Set<string>>();
  const dimPos = new Map<string, Set<string>>();
  const collect = (dims: Record<string, string>, posId: string): void => {
    for (const [dimId, valId] of Object.entries(dims)) {
      if (!dimValues.has(dimId)) {
        dimValues.set(dimId, new Set());
        dimPos.set(dimId, new Set());
      }
      dimValues.get(dimId)?.add(valId);
      dimPos.get(dimId)?.add(posId);
    }
  };

  const activeRules = rules.filter((r) => !r.disabled);
  for (const rule of activeRules) {
    const fused = (rule.fused_dimensions ?? []).filter(
      (dict) => Object.keys(dict).length > 0,
    );
    if (fused.length > 0) {
      for (const dict of fused) collect(dict, rule.pos_id);
    } else {
      collect(rule.dimension_values ?? {}, rule.pos_id);
    }
  }

  const dimensions: InflectionDimension[] = [...dimValues.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dimId, values]) => ({
      dim_id: dimId,
      name: dimId,
      applies_to_pos: [...(dimPos.get(dimId) ?? [])].sort(),
      values: [...values]
        .sort()
        .map((valId) => ({ val_id: valId, name: valId, gloss: valId })),
    }));

  return {
    language_id: "",
    syntax: {
      word_order: "SVO",
      modifier_position: "after_head",
      adposition_type: "preposition",
    },
    parts_of_speech: [],
    inflection_dimensions: dimensions,
    inflection_rules: activeRules,
    derivation_rules: [],
    grammar_manual: [],
    typology: {
      morphological_type: "fusional",
      synthesis_index: 2,
      fusion_index: 2,
      head_marking: "none",
      auto_estimated: false,
    },
    affix_slots: [],
    conjugation_classes: [],
    irregular_overrides: [],
  };
}

/**
 * 生成 .dic 文件内容（旧签名兼容层）
 * 格式：首行词条计数，后续每行一个词条
 * 包含基础形式和所有屈折形式
 */
export function generateDic(
  words: WordEntry[],
  inflectionRules?: InflectionRule[],
  phonoConfig?: PhonologyConfig,
): string {
  if (!inflectionRules || !phonoConfig) {
    const forms = [...new Set(words.map((w) => w.con_word_romanized).filter(Boolean))];
    const sorted = forms.sort();
    return [String(sorted.length), ...sorted].join("\n");
  }
  return generateDicFromGrammar(words, pseudoGrammarFromRules(inflectionRules), phonoConfig);
}
