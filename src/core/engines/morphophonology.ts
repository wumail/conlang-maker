/**
 * morphophonology.ts — 共时形态音位层（跨词素边界 `+`）
 *
 * 屈折/派生拼接时先生成带 `+` 边界的中间串（`ev+lar`），本模块按规则顺序
 * 执行同化、元音和谐、弱化等跨边界调整，最后去掉 `+` 得到表层词形。
 *
 * 规则语境支持：
 *   - 字面量音素（`e`、`tʃ`）
 *   - `V` / `C`（任意元音 / 辅音）
 *   - `#`（词首 / 词尾）
 *   - `+`（词素边界）
 *   - `X*`（前一项零次或多次）
 */
import type {
  MorphophonologyRule,
  PhonemeInventory,
  PhonologyConfig,
} from "../../types";
import { tokenizePhonemes } from "./phonemeTokenizer";
import { basePhoneme } from "./syllabifier";

export interface MorphophonologyStep {
  ruleId: string;
  description: string;
  before: string;
  after: string;
}

export interface MorphophonologyResult {
  /** 已去除 `+` 的表层词形 */
  surface: string;
  /** 保留 `+` 的中间串（调试用） */
  intermediate: string;
  steps: MorphophonologyStep[];
}

interface BoundedToken {
  value: string;
  /** 该 token 是否处于词素边界之后 */
  boundaryBefore: boolean;
}

export const MORPHEME_BOUNDARY = "+";

function allPhonemesOf(inventory: PhonemeInventory): string[] {
  return [...inventory.consonants, ...inventory.vowels];
}

/** 按 `+` 切分并逐段音素化，保留边界标记 */
export function tokenizeWithBoundaries(
  text: string,
  inventory: PhonemeInventory,
): BoundedToken[] {
  const known = allPhonemesOf(inventory);
  const morphemes = text.split(MORPHEME_BOUNDARY);
  const tokens: BoundedToken[] = [];
  morphemes.forEach((morpheme, index) => {
    const parts = tokenizePhonemes(morpheme, known);
    parts.forEach((value, partIndex) => {
      tokens.push({ value, boundaryBefore: index > 0 && partIndex === 0 });
    });
  });
  return tokens;
}

function renderTokens(tokens: readonly BoundedToken[], keepBoundaries: boolean): string {
  let out = "";
  tokens.forEach((token, index) => {
    if (keepBoundaries && token.boundaryBefore && index > 0) out += MORPHEME_BOUNDARY;
    out += token.value;
  });
  return out;
}

function matchesToken(
  value: string,
  pattern: string,
  inventory: PhonemeInventory,
): boolean {
  if (pattern === "V") return inventory.vowels.includes(value);
  if (pattern === "C") return inventory.consonants.includes(value);
  return value === pattern || basePhoneme(value) === basePhoneme(pattern);
}

function splitPattern(pattern: string): string[] {
  return pattern.trim().length === 0 ? [] : pattern.trim().split(/\s+/u);
}

/** 向后匹配语境（`endExclusive` 为「下一个待匹配 token 的下标」） */
function matchBackward(
  pattern: string[],
  tokens: readonly BoundedToken[],
  endExclusive: number,
  inventory: PhonemeInventory,
): boolean {
  if (pattern.length === 0) return true;
  const head = pattern[pattern.length - 1]!;
  const rest = pattern.slice(0, -1);

  if (head === MORPHEME_BOUNDARY) {
    // 边界可紧邻 target 之前（affix 首音素）或其再前一个 token
    const flagIndex = tokens[endExclusive]?.boundaryBefore
      ? endExclusive
      : tokens[endExclusive - 1]?.boundaryBefore
        ? endExclusive - 1
        : -1;
    if (flagIndex < 0) return false;
    // 继续匹配「边界左侧」的音素（边界本身不消耗 token）
    return matchBackward(rest, tokens, flagIndex, inventory);
  }
  if (head === "#") {
    return endExclusive === 0 && rest.length === 0;
  }
  if (head.endsWith("*")) {
    const base = head.slice(0, -1);
    let count = 0;
    while (
      endExclusive - count - 1 >= 0 &&
      matchesToken(tokens[endExclusive - count - 1]!.value, base, inventory)
    ) {
      count += 1;
    }
    for (let take = count; take >= 0; take -= 1) {
      if (matchBackward(rest, tokens, endExclusive - take, inventory)) return true;
    }
    return false;
  }
  if (endExclusive === 0) return false;
  if (!matchesToken(tokens[endExclusive - 1]!.value, head, inventory)) return false;
  return matchBackward(rest, tokens, endExclusive - 1, inventory);
}

/** 向前匹配语境（`start` 为「下一个待匹配 token 的下标」） */
function matchForward(
  pattern: string[],
  tokens: readonly BoundedToken[],
  start: number,
  inventory: PhonemeInventory,
): boolean {
  if (pattern.length === 0) return true;
  const head = pattern[0]!;
  const rest = pattern.slice(1);

  if (head === MORPHEME_BOUNDARY) {
    const flagIndex = tokens[start]?.boundaryBefore
      ? start
      : tokens[start + 1]?.boundaryBefore
        ? start + 1
        : -1;
    if (flagIndex < 0) return false;
    // 继续匹配「边界右侧」的音素
    return matchForward(rest, tokens, flagIndex, inventory);
  }
  if (head === "#") {
    return start === tokens.length && rest.length === 0;
  }
  if (head.endsWith("*")) {
    const base = head.slice(0, -1);
    let count = 0;
    while (
      start + count < tokens.length &&
      matchesToken(tokens[start + count]!.value, base, inventory)
    ) {
      count += 1;
    }
    for (let take = count; take >= 0; take -= 1) {
      if (matchForward(rest, tokens, start + take, inventory)) return true;
    }
    return false;
  }
  if (start >= tokens.length) return false;
  if (!matchesToken(tokens[start]!.value, head, inventory)) return false;
  return matchForward(rest, tokens, start + 1, inventory);
}

interface RuleApplication {
  tokens: BoundedToken[];
  changed: boolean;
}

function applyRuleOnce(
  tokens: readonly BoundedToken[],
  rule: MorphophonologyRule,
  inventory: PhonemeInventory,
): RuleApplication {
  const targets = splitPattern(rule.target);
  if (targets.length === 0) return { tokens: [...tokens], changed: false };

  const beforePattern = splitPattern(rule.context_before);
  const afterPattern = splitPattern(rule.context_after);
  const replacementRaw = rule.replacement.trim();
  const replacement =
    replacementRaw === "" || replacementRaw === "∅" || replacementRaw === "0"
      ? []
      : replacementRaw.split(/\s+/u);

  const out: BoundedToken[] = [];
  let changed = false;
  let index = 0;
  while (index < tokens.length) {
    const slice = tokens.slice(index, index + targets.length);
    const matchesTarget =
      slice.length === targets.length &&
      targets.every((target, offset) =>
        matchesToken(tokens[index + offset]!.value, target, inventory),
      );

    if (
      matchesTarget &&
      matchBackward(beforePattern, tokens, index, inventory) &&
      matchForward(afterPattern, tokens, index + targets.length, inventory)
    ) {
      const boundaryBefore = tokens[index]!.boundaryBefore;
      replacement.forEach((value, offset) => {
        out.push({ value, boundaryBefore: offset === 0 ? boundaryBefore : false });
      });
      changed = true;
      index += targets.length;
      continue;
    }
    out.push(tokens[index]!);
    index += 1;
  }

  return { tokens: out, changed };
}

/**
 * 应用形态音位规则。
 *
 * 规则按 `priority` 升序执行（同优先级保持数组顺序）；每条规则循环应用至
 * 不再变化（上限 20 轮）以支持和谐传播。
 */
export function applyMorphophonology(
  intermediate: string,
  rules: readonly MorphophonologyRule[],
  phonoConfig: PhonologyConfig,
): MorphophonologyResult {
  const inventory = phonoConfig.phoneme_inventory;
  let tokens = tokenizeWithBoundaries(intermediate, inventory);
  const steps: MorphophonologyStep[] = [];

  const ordered = [...rules]
    .filter((rule) => !rule.disabled)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  for (const rule of ordered) {
    if (rule.feature_mode) continue; // 特征模式留待 SCA 引擎处理
    const before = renderTokens(tokens, true);
    for (let pass = 0; pass < 20; pass += 1) {
      const application = applyRuleOnce(tokens, rule, inventory);
      if (!application.changed) break;
      tokens = application.tokens;
    }
    const after = renderTokens(tokens, true);
    if (after !== before) {
      steps.push({
        ruleId: rule.rule_id,
        description: rule.description,
        before,
        after,
      });
    }
  }

  return {
    surface: renderTokens(tokens, false),
    intermediate: renderTokens(tokens, true),
    steps,
  };
}

/** 便捷封装：无规则时直接去边界 */
export function surfaceOf(intermediate: string): string {
  return intermediate.split(MORPHEME_BOUNDARY).join("");
}
