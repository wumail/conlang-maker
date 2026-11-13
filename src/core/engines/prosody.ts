/**
 * prosody.ts — 音节级超音段信息（重音 / 开闭音节 / 首末音节）
 *
 * 供三条链路共用：
 *   1. `ipaGenerator` 计算主重音位置；
 *   2. `scaEngine` 向特征规则注入 `+stressed` / `+open_syllable` 等伪特征；
 *   3. `morphophonology` 做跨词素边界的元音和谐与弱化。
 */
import type {
  PhonemeInventory,
  Phonotactics,
  StressConfig,
  StressPattern,
} from "../../types";
import {
  syllabify,
  type ParsedSyllable,
  type SyllabificationResult,
} from "./syllabifier";

export interface TokenProsodyMeta {
  stressed: boolean;
  open_syllable: boolean;
  closed_syllable: boolean;
  initial_syllable: boolean;
  final_syllable: boolean;
}

/** 只在 SCA 特征表达式里生效的伪特征名（不写入 `distinctive_features.ts`） */
export const PROSODIC_PSEUDO_FEATURES = new Set([
  "stressed",
  "unstressed",
  "open_syllable",
  "closed_syllable",
  "initial_syllable",
  "final_syllable",
]);

export function emptyProsodyMeta(): TokenProsodyMeta {
  return {
    stressed: false,
    open_syllable: false,
    closed_syllable: false,
    initial_syllable: false,
    final_syllable: false,
  };
}

/** 判断某伪特征是否在该 token 上成立 */
export function prosodyHasFeature(
  meta: TokenProsodyMeta | undefined,
  feature: string,
): boolean | null {
  if (!meta) return null;
  switch (feature) {
    case "stressed":
      return meta.stressed;
    case "unstressed":
      return !meta.stressed;
    case "open_syllable":
      return meta.open_syllable;
    case "closed_syllable":
      return meta.closed_syllable;
    case "initial_syllable":
      return meta.initial_syllable;
    case "final_syllable":
      return meta.final_syllable;
    default:
      return null;
  }
}

const POSITION_INDEX: Record<Exclude<StressPattern, "weight_sensitive">, number> = {
  initial: 0,
  ultimate: 0,
  penultimate: 1,
  antepenultimate: 2,
};

/**
 * 选出承载主重音的音节下标（无法判定时返回 -1）。
 *
 * `weight_sensitive`：取最后一个重音节；若全为轻音节，按 `weight_fallback`
 * （默认 `penultimate`）回退。
 */
export function pickStressedSyllable(
  syllables: readonly ParsedSyllable[],
  stress?: StressConfig | null,
): number {
  if (!stress || syllables.length === 0) return -1;
  const position = stress.position ?? "initial";

  if (position === "weight_sensitive") {
    for (let index = syllables.length - 1; index >= 0; index -= 1) {
      if (syllables[index]?.weight === "heavy") return index;
    }
    const fallback = stress.weight_fallback ?? "penultimate";
    return resolveFromEnd(syllables.length, fallback);
  }

  if (position === "initial") return 0;
  return resolveFromEnd(syllables.length, position);
}

function resolveFromEnd(
  length: number,
  position: Exclude<StressPattern, "weight_sensitive">,
): number {
  const offset = POSITION_INDEX[position] ?? 0;
  if (position === "initial") return 0;
  return length - 1 - offset < 0 ? 0 : length - 1 - offset;
}

/**
 * 为每个音素 token 计算超音段信息。
 *
 * 音节切分失败时返回全 false（退化行为：不注入任何伪特征，规则按普通特征匹配）。
 */
export function computeTokenProsody(
  tokens: readonly string[],
  phonotactics: Phonotactics | undefined,
  inventory: PhonemeInventory | undefined,
  stress?: StressConfig | null,
): TokenProsodyMeta[] {
  const metas = tokens.map(() => emptyProsodyMeta());
  if (!phonotactics || !inventory || tokens.length === 0) return metas;

  let result: SyllabificationResult;
  try {
    result = syllabify([...tokens], phonotactics, inventory);
  } catch {
    return metas;
  }
  if (!result.valid || result.syllables.length === 0) return metas;

  const stressedIndex = pickStressedSyllable(result.syllables, stress);
  let cursor = 0;
  result.syllables.forEach((syllable, index) => {
    const size = syllable.onset.length + syllable.nucleus.length + syllable.coda.length;
    const isLast = index === result.syllables.length - 1;
    for (let offset = 0; offset < size; offset += 1) {
      const tokenIndex = cursor + offset;
      const meta = metas[tokenIndex];
      if (!meta) continue;
      meta.stressed = index === stressedIndex;
      meta.open_syllable = syllable.coda.length === 0;
      meta.closed_syllable = syllable.coda.length > 0;
      meta.initial_syllable = index === 0;
      meta.final_syllable = isLast;
    }
    cursor += size;
  });
  return metas;
}

/** 规则是否引用了任一伪特征（用于跳过无谓的音节切分） */
export function ruleUsesProsody(rule: {
  target_features?: { positive: string[]; negative: string[] } | null;
  context_before_features?: { positive: string[]; negative: string[] } | null;
  context_after_features?: { positive: string[]; negative: string[] } | null;
  replacement_features?: { set_features: string[]; remove_features: string[] } | null;
}): boolean {
  const exprs = [
    rule.target_features,
    rule.context_before_features,
    rule.context_after_features,
    rule.replacement_features,
  ];
  for (const expr of exprs) {
    if (!expr) continue;
    const names = [
      ...("positive" in expr ? expr.positive : []),
      ...("negative" in expr ? expr.negative : []),
      ...("set_features" in expr ? expr.set_features : []),
      ...("remove_features" in expr ? expr.remove_features : []),
    ];
    if (names.some((name) => PROSODIC_PSEUDO_FEATURES.has(name))) return true;
  }
  return false;
}
