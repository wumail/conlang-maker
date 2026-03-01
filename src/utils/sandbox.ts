/**
 * sandbox.ts — Phase 2 翻译沙盒引擎
 *
 * 已集成 morphologyEngine，支持全部 6 种形态类型
 * + 句法重排 reorderBySyntax()
 * + 自动屈折 autoApplyInflections()
 */
import { WordEntry, InflectionRule, PhonologyConfig, GrammarConfig, SyntaxConfig } from '../types';
import { applyAllophony, romanizationToPhonemes } from './ipaGenerator';
import { applyInflection } from './morphologyEngine';

export interface SandboxResult {
  original: string;
  conlang: string;
  ipa: string;
  gloss: string;
}

// ── 词条查找 ─────────────────────────────────────────────

const lookupByGloss = (glossQuery: string, wordsMap: Record<string, WordEntry>): { word: WordEntry; posId: string } | undefined => {
  const normalized = glossQuery.toLowerCase().trim();
  for (const w of Object.values(wordsMap)) {
    const sense = w.senses.find(s => s.gloss.toLowerCase().trim() === normalized);
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
  phonoConfig: PhonologyConfig
): { result: string; appliedTags: string[] } => {
  let word = conWord;
  const appliedTags: string[] = [];
  for (const tag of tags) {
    // 优先匹配同 POS 的规则
    let rule = rules.find(r =>
      r.tag.toUpperCase() === tag.toUpperCase() &&
      r.pos_id === posId &&
      !r.disabled
    );
    // Fallback: 匹配任意 POS 的规则
    if (!rule) {
      rule = rules.find(r => r.tag.toUpperCase() === tag.toUpperCase() && !r.disabled);
    }
    if (!rule) continue;

    const { result, applied } = applyInflection(word, rule, phonoConfig);
    if (applied) {
      word = result;
      appliedTags.push(tag);
    }
  }
  return { result: word, appliedTags };
};

// ── 句法重排 ─────────────────────────────────────────────

export type SyntaxRole = 'S' | 'V' | 'O' | 'Mod' | 'Adp' | 'Other';

export interface AnnotatedToken {
  gloss: string;
  role: SyntaxRole;
  tags: string[];
}

/**
 * 根据 syntax config 对已标注角色的 token 列表重新排序
 * 支持 6 种语序 + modifier_position + adposition_type
 */
export function reorderBySyntax(tokens: AnnotatedToken[], syntax: SyntaxConfig): AnnotatedToken[] {
  const orderMap: Record<string, SyntaxRole[]> = {
    SVO: ['S', 'V', 'O'],
    SOV: ['S', 'O', 'V'],
    VSO: ['V', 'S', 'O'],
    VOS: ['V', 'O', 'S'],
    OVS: ['O', 'V', 'S'],
    OSV: ['O', 'S', 'V'],
  };

  const order = orderMap[syntax.word_order] || ['S', 'V', 'O'];
  const grouped: Record<string, AnnotatedToken[]> = { S: [], V: [], O: [], Mod: [], Adp: [], Other: [] };

  for (const t of tokens) {
    (grouped[t.role] || grouped['Other']).push(t);
  }

  const result: AnnotatedToken[] = [];

  // 按语序排列核心成分，Modifier 根据 modifier_position 附着
  for (const role of order) {
    const core = grouped[role] || [];
    if (role === 'S' || role === 'O') {
      // Adposition 处理
      const adpTokens = role === 'O' ? grouped['Adp'] : [];
      if (syntax.adposition_type === 'preposition') {
        result.push(...adpTokens);
      }

      // Modifier 位置
      const mods = grouped['Mod'].filter(() => role === 'O'); // Modifier 默认修饰 O
      if (syntax.modifier_position === 'before_head') {
        result.push(...mods, ...core);
      } else {
        result.push(...core, ...mods);
      }

      if (syntax.adposition_type === 'postposition') {
        result.push(...adpTokens);
      }
    } else {
      result.push(...core);
    }
  }

  // 追加未分类 token
  result.push(...grouped['Other']);

  return result;
}

/**
 * 根据句法角色自动推断应用的屈折标签
 * - S → NOM (主格), V → 默认时态, O → ACC (宾格)
 */
export function autoApplyInflections(
  role: SyntaxRole,
  dimensions: GrammarConfig['inflection_dimensions'],
  posId: string
): string[] {
  const tags: string[] = [];
  for (const dim of dimensions) {
    if (!dim.applies_to_pos.includes(posId)) continue;
    // 根据角色选择默认维度值
    const defaultVal = dim.values[0];
    if (!defaultVal) continue;

    // 智能映射：如果维度名含 case 相关词，按角色选择
    const dimName = dim.name.toLowerCase();
    if (dimName.includes('case') || dimName.includes('格')) {
      if (role === 'S') {
        // 找 nominative
        const nom = dim.values.find(v =>
          v.gloss.toLowerCase().includes('nom') || v.name.toLowerCase().includes('nominat')
        );
        if (nom) tags.push(nom.gloss || nom.name);
      } else if (role === 'O') {
        // 找 accusative
        const acc = dim.values.find(v =>
          v.gloss.toLowerCase().includes('acc') || v.name.toLowerCase().includes('accusat')
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
  phonology: PhonologyConfig
): SandboxResult[] => {
  const tokens = text.split(/\s+/).filter(t => t.trim() !== '');
  const rules = grammarConfig.inflection_rules || [];

  // Find default romanization map
  const defaultMap =
    phonology.romanization_maps.find(m => m.is_default) ??
    phonology.romanization_maps[0];

  return tokens.map(token => {
    const parts = token.split('-');
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

    // Apply inflection rules via morphologyEngine
    const { result } = applyInflections(conlangWord, tags, posId, rules, phonology);
    conlangWord = result;

    // Generate IPA
    let baseIpa: string;
    if (wordEntry.phonetic_override && wordEntry.phonetic_ipa) {
      baseIpa = wordEntry.phonetic_ipa.replace(/[\/\[\]]/g, '');
    } else if (defaultMap) {
      baseIpa = romanizationToPhonemes(conlangWord, defaultMap);
    } else {
      baseIpa = conlangWord;
    }

    const finalIpa = applyAllophony(
      baseIpa,
      phonology.allophony_rules,
      phonology.phonotactics.macros
    );

    // Build gloss string: root gloss + tags
    const glossStr = tags.length > 0
      ? `${rootGloss}-${tags.join('-')}`
      : rootGloss;

    return {
      original: token,
      conlang: conlangWord,
      ipa: `/${finalIpa}/`,
      gloss: glossStr,
    };
  });
};
