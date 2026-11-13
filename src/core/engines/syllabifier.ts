/**
 * syllabifier.ts — DP + 最大声母原则（Maximal Onset Principle）音节切分器
 *
 * 设计要点（见 PRD §2.2 / EXECUTION_PLAN §7.1）：
 * 1. 模板编译为「槽位状态序列」，避免 `(C)(L)V(N)` 之类模板的 2^k 字符串展开；
 * 2. DP 在音素 token 数组下标上推进，绝不 `.join("")` 后做字符级切分，
 *    因此 `tʃ`、`kʰ`、`aː` 等多字符音素不会被拆碎；
 * 3. 多解消歧：先最小化音节数，其次在音节交界处最大化后一音节声母长度。
 */
import type { PhonemeInventory, Phonotactics } from "../../types";

export type SyllableWeight = "light" | "heavy";
export type SyllableSlotRole = "onset" | "nucleus" | "coda";

export interface ParsedSyllable {
  onset: string[];
  nucleus: string[];
  coda: string[];
  weight: SyllableWeight;
}

export interface SyllabificationResult {
  valid: boolean;
  syllables: ParsedSyllable[];
  failedAtTokenIndex?: number;
}

export interface SlotUnit {
  allowed: Set<string>;
  optional: boolean;
  role: SyllableSlotRole;
}

/** 没有任何模板时使用的兜底结构 */
export const FALLBACK_SYLLABLE_STRUCTURE = "CV";

/** 长音/半长音/重音等超音段符号，判定元音时需剥离 */
const SUPRASEGMENTAL_CHARS = new Set([
  "ː",
  "ˑ",
  "ʰ",
  "ʲ",
  "ʷ",
  "ˠ",
  "ˤ",
  "ʼ",
  "ˈ",
  "ˌ",
  "̥",
  "̊",
  "̃",
  "̩",
  "̯",
]);

/** 剥离超音段与组合附加符号，得到判定用的基础音素 */
export function basePhoneme(token: string): string {
  let out = "";
  for (const ch of token) {
    if (SUPRASEGMENTAL_CHARS.has(ch)) continue;
    const code = ch.codePointAt(0) ?? 0;
    // 组合附加符号区（U+0300–U+036F）
    if (code >= 0x0300 && code <= 0x036f) continue;
    out += ch;
  }
  return out;
}

function isVowelToken(token: string, vowelSet: Set<string>): boolean {
  if (vowelSet.has(token)) return true;
  const base = basePhoneme(token);
  return base.length > 0 && vowelSet.has(base);
}

/**
 * 槽位是否接受该 token：
 * 1. 直接收录（如 `aː` 这类长元音已在 inventory 中）；
 * 2. 未直接收录时剥离超音段符号回退匹配基础音素（`aː` → `a`）；
 *    token 本身保持原样，因此 `aː` 依旧被判定为 heavy 音重。
 */
function slotAccepts(unit: SlotUnit, token: string): boolean {
  if (unit.allowed.has(token)) return true;
  // 仅对长音（ː / ˑ）回退，避免放过带其他附加符号的非法音素
  if (!token.includes("ː") && !token.includes("ˑ")) return false;
  const base = basePhoneme(token);
  return base.length > 0 && unit.allowed.has(base);
}

/**
 * 1. 编译模板（避免 2^k 展开指数爆炸）：
 *    支持 `(C)(L)V(N)`、`C?VC?` 与 `{CL}V` 等写法；
 *    宏名可为多字符：花括号 `{CL}` 优先，其次按「最长已知宏键」匹配；
 *    宏未定义时回退：`C` → inventory.consonants，`V` → inventory.vowels，其余 → 字面量槽位。
 */
export function compileSyllableUnits(
  structure: string,
  macros: Record<string, string[]>,
  inventory: PhonemeInventory,
): SlotUnit[] {
  const effectiveMacros: Record<string, Set<string>> = {
    C: new Set(inventory.consonants),
    V: new Set(inventory.vowels),
  };
  for (const [key, values] of Object.entries(macros ?? {})) {
    effectiveMacros[key] = new Set(values);
  }
  // 长宏名优先匹配，避免 `CL` 被拆成 `C` + `L`
  const multiCharKeys = Object.keys(effectiveMacros)
    .filter((key) => key.length > 1)
    .sort((left, right) => right.length - left.length);

  const readSlot = (text: string, index: number): { allowed: Set<string>; next: number } | null => {
    const character = text[index];
    if (character === undefined) return null;
    if (character === "{") {
      const close = text.indexOf("}", index + 1);
      if (close <= index + 1) return null;
      const name = text.slice(index + 1, close).trim();
      return { allowed: effectiveMacros[name] ?? new Set([name]), next: close + 1 };
    }
    for (const key of multiCharKeys) {
      if (text.startsWith(key, index)) {
        return { allowed: effectiveMacros[key]!, next: index + key.length };
      }
    }
    return { allowed: effectiveMacros[character] ?? new Set([character]), next: index + 1 };
  };

  const rawUnits: { allowed: Set<string>; optional: boolean }[] = [];
  const source = structure.trim();
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === " " || ch === "\t" || ch === "|" || ch === ".") {
      i += 1;
      continue;
    }
    if (ch === "(") {
      const close = source.indexOf(")", i + 1);
      if (close > i + 1) {
        const inner = source.slice(i + 1, close);
        let cursor = 0;
        while (cursor < inner.length) {
          const slot = readSlot(inner, cursor);
          if (!slot) {
            cursor += 1;
            continue;
          }
          rawUnits.push({ allowed: slot.allowed, optional: true });
          cursor = slot.next;
        }
        i = close + 1;
        continue;
      }
    }
    if (ch === ")") {
      i += 1;
      continue;
    }
    const slot = readSlot(source, i);
    if (!slot) {
      i += 1;
      continue;
    }
    const nextIsOptional = source[slot.next] === "?";
    rawUnits.push({ allowed: slot.allowed, optional: nextIsOptional });
    i = nextIsOptional ? slot.next + 1 : slot.next;
  }

  return assignRoles(rawUnits, new Set(inventory.vowels));
}

/**
 * 槽位角色分类：首个可容纳元音的槽位为 nucleus 起点，紧随其后的元音槽位同样计入 nucleus，
 * 之前的槽位为 onset，之后的槽位为 coda。
 */
function assignRoles(
  units: { allowed: Set<string>; optional: boolean }[],
  vowelSet: Set<string>,
): SlotUnit[] {
  const hasVowel = units.map((unit) =>
    [...unit.allowed].some((token) => isVowelToken(token, vowelSet)),
  );
  const firstNucleus = hasVowel.indexOf(true);
  let lastNucleus = firstNucleus;
  while (lastNucleus >= 0 && lastNucleus + 1 < units.length && hasVowel[lastNucleus + 1]) {
    lastNucleus += 1;
  }

  return units.map((unit, index) => {
    let role: SyllableSlotRole = "onset";
    if (firstNucleus >= 0 && index >= firstNucleus && index <= lastNucleus) role = "nucleus";
    else if (lastNucleus >= 0 && index > lastNucleus) role = "coda";
    return { allowed: unit.allowed, optional: unit.optional, role };
  });
}

/** 单音节内部切分：首个连续元音段为 nucleus，其余为 onset / coda */
export function buildParsedSyllable(
  tokens: string[],
  vowelSet: Set<string>,
): ParsedSyllable | null {
  let nucleusStart = -1;
  for (let index = 0; index < tokens.length; index += 1) {
    if (isVowelToken(tokens[index]!, vowelSet)) {
      nucleusStart = index;
      break;
    }
  }
  if (nucleusStart < 0) return null;

  let nucleusEnd = nucleusStart;
  while (nucleusEnd + 1 < tokens.length && isVowelToken(tokens[nucleusEnd + 1]!, vowelSet)) {
    nucleusEnd += 1;
  }

  const nucleus = tokens.slice(nucleusStart, nucleusEnd + 1);
  const coda = tokens.slice(nucleusEnd + 1);
  const heavy =
    coda.length > 0 || nucleus.length > 1 || nucleus.some((token) => token.includes("ː"));

  return {
    onset: tokens.slice(0, nucleusStart),
    nucleus,
    coda,
    weight: heavy ? "heavy" : "light",
  };
}

/**
 * 2. 最优解比较器：音节数更少者胜出；音节数相同时，从第 2 个音节起从左向右比较，
 *    首个 `onset.length` 不同的位置取更大者（最大声母原则，`a.pa` 优于 `ap.a`）。
 */
function isBetterPlan(candidate: ParsedSyllable[], best: ParsedSyllable[] | null): boolean {
  if (!best) return true;
  if (candidate.length !== best.length) return candidate.length < best.length;
  for (let k = 1; k < candidate.length; k += 1) {
    const diff = candidate[k]!.onset.length - best[k]!.onset.length;
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/** 枚举从 start 出发、匹配槽位序列的全部合法终点（不改变 token 数组） */
function enumerateSyllableEnds(
  units: SlotUnit[],
  tokens: string[],
  start: number,
): number[] {
  const ends = new Set<number>();

  const walk = (unitIndex: number, tokenIndex: number): void => {
    if (unitIndex === units.length) {
      if (tokenIndex > start) ends.add(tokenIndex);
      return;
    }
    const unit = units[unitIndex]!;
    const token = tokens[tokenIndex];
    if (token !== undefined && slotAccepts(unit, token)) {
      walk(unitIndex + 1, tokenIndex + 1);
    }
    if (unit.optional) walk(unitIndex + 1, tokenIndex);
  };

  walk(0, start);
  return [...ends].sort((a, b) => a - b);
}

/**
 * 使用预编译槽位执行 DP 切分（供批量质检复用，避免逐词重编译模板）。
 */
export function syllabifyWithUnits(
  phonemes: string[],
  units: SlotUnit[],
  vowelSet: Set<string>,
): SyllabificationResult {
  if (phonemes.length === 0) return { valid: true, syllables: [] };
  if (units.length === 0) {
    return { valid: false, syllables: [], failedAtTokenIndex: 0 };
  }

  const total = phonemes.length;
  const dp: (ParsedSyllable[] | null)[] = new Array<ParsedSyllable[] | null>(total + 1).fill(null);
  dp[0] = [];

  for (let i = 0; i < total; i += 1) {
    const prefix = dp[i];
    if (!prefix) continue;
    for (const end of enumerateSyllableEnds(units, phonemes, i)) {
      const syllable = buildParsedSyllable(phonemes.slice(i, end), vowelSet);
      if (!syllable) continue;
      const candidate = [...prefix, syllable];
      if (isBetterPlan(candidate, dp[end] ?? null)) dp[end] = candidate;
    }
  }

  const full = dp[total];
  if (full) return { valid: true, syllables: full };

  let failedAt = 0;
  for (let k = total - 1; k >= 0; k -= 1) {
    if (dp[k]) {
      failedAt = k;
      break;
    }
  }
  return { valid: false, syllables: [], failedAtTokenIndex: failedAt };
}

/**
 * 3. 面向 Phonotactics 的公开入口。
 */
export function syllabify(
  phonemes: string[],
  phonotactics: Phonotactics,
  inventory: PhonemeInventory,
): SyllabificationResult {
  const units = compileSyllableUnits(
    phonotactics.syllable_structure?.trim() || FALLBACK_SYLLABLE_STRUCTURE,
    phonotactics.macros ?? {},
    inventory,
  );
  return syllabifyWithUnits(phonemes, units, new Set(inventory.vowels));
}

/** 渲染 `a.pa` 形式的音节切分结果（调试与 UI 预览用） */
export function formatSyllables(syllables: ParsedSyllable[]): string {
  return syllables
    .map((syllable) => [...syllable.onset, ...syllable.nucleus, ...syllable.coda].join(""))
    .join(".");
}
