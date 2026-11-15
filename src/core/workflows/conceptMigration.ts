/**
 * conceptMigration.ts — 旧式「概念标签」到 `Sense.concept_id` 的迁移工作流
 *
 * 历史工作区常把概念写进 `metadata.tags`（`概念:水` / `概念12` / `concept:water`）。
 * 本模块把这些标签解析成标准概念锚点，产出可预览的 dry-run 计划，再由
 * `applyConceptMigration` 纯函数落地——**幂等**：重复执行不会产生新变更。
 */
import type { ConceptDefinition, LanguageEntry, WordEntry } from "../../types";
import { CORE_CONCEPTS, getCoreConcept } from "../../data/core_concepts";
import { SWADESH_100 } from "../engines/wordGenerator";

export type ConceptTagStatus =
  | "resolved" // 语义精确命中，可自动迁移
  | "needs_confirm" // 纯数字序号猜测，需用户核对后才能绑定
  | "already-applied" // 已绑定同一概念，无需变更
  | "conflict" // 已有不同 concept_id 或多个标签互斥
  | "unresolved"; // 无法解析，建议新建自定义概念

export interface ConceptTagCandidate {
  entryId: string;
  word: string;
  /** 原始标签文本 */
  tag: string;
  /** 标签里抽取出的概念键 */
  rawValue: string;
  /** 解析出的标准 concept_id（unresolved 时为 null） */
  conceptId: string | null;
  /** 解析出的展示名（中文优先） */
  label: string;
  status: ConceptTagStatus;
  /** conflict 时给出既有 concept_id 或冲突标签 */
  conflictWith?: string;
}

/** 候选行的稳定键（entryId + 原始标签），用于 UI 勾选与定向应用 */
export function candidateKey(candidate: ConceptTagCandidate): string {
  return `${candidate.entryId}::${candidate.tag}`;
}

export interface ConceptMigrationPlan {
  candidates: ConceptTagCandidate[];
  resolved: ConceptTagCandidate[];
  /** 纯数字序号猜测：默认不勾选，需用户核对后显式确认 */
  needsConfirm: ConceptTagCandidate[];
  conflicts: ConceptTagCandidate[];
  unresolved: ConceptTagCandidate[];
  alreadyApplied: ConceptTagCandidate[];
  /** 需要新建的自定义概念（unresolved 去重后） */
  suggestedConcepts: ConceptDefinition[];
  /** 至少有一条可迁移或可新建才需要用户确认 */
  hasWork: boolean;
}

export interface ApplyConceptMigrationOptions {
  /** 迁移后从 tags 中移除对应标签（默认 false，保留原标签便于回溯） */
  stripTags?: boolean;
  /**
   * 本次显式勾选的候选键（`candidateKey`）。提供时只有集合内的候选会被应用，
   * 未列出的 `needs_confirm` 猜测项永不自动绑定。
   */
  applyKeys?: ReadonlySet<string>;
}

export interface ConceptMigrationResult {
  words: WordEntry[];
  /** 需要追加到 WorkspaceConfig.custom_concepts 的新概念 */
  customConcepts: ConceptDefinition[];
  changedEntries: number;
  strippedTags: number;
}

const TAG_PATTERNS: RegExp[] = [
  /^概念\s*[:：]\s*(.+)$/u,
  /^concept\s*[:：]\s*(.+)$/iu,
  /^概念\s*(\d+)$/u,
];

/** 从标签中抽取概念键；不是概念标签返回 null */
export function extractConceptTagValue(tag: string): string | null {
  const trimmed = tag.trim();
  if (!trimmed) return null;
  for (const pattern of TAG_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match) return match[1].trim();
  }
  return null;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

interface ResolvedConcept {
  concept: ConceptDefinition | null;
  /** 是否由 Swadesh 序号猜测得到（纯数字标签），需人工核对 */
  guessedByIndex: boolean;
}

/**
 * 按 concept_id / 英文释义 / 中文释义解析概念。
 *
 * 纯数字标签（`概念071`）只做 Swadesh 序号**猜测**，标记 `guessedByIndex`，
 * 绝不会被静默当作精确匹配；只有 `概念:水` / `concept:water` 这类语义标签
 * 才算精确命中。
 */
function resolveConcept(
  rawValue: string,
  customConcepts: readonly ConceptDefinition[],
): ResolvedConcept {
  const key = normalizeKey(rawValue);
  if (!key) return { concept: null, guessedByIndex: false };

  if (/^\d+$/.test(key)) {
    const index = Number(key) - 1;
    const gloss = SWADESH_100[index];
    if (!gloss) return { concept: null, guessedByIndex: true };
    return { concept: findByGloss(gloss, customConcepts), guessedByIndex: true };
  }

  const direct = getCoreConcept(key);
  if (direct) return { concept: direct, guessedByIndex: false };

  const customDirect = customConcepts.find(
    (concept) => normalizeKey(concept.concept_id) === key,
  );
  if (customDirect) return { concept: customDirect, guessedByIndex: false };

  return { concept: findByGloss(key, customConcepts), guessedByIndex: false };
}

function findByGloss(
  gloss: string,
  customConcepts: readonly ConceptDefinition[],
): ConceptDefinition | null {
  const key = normalizeKey(gloss);
  const pool = [...CORE_CONCEPTS, ...customConcepts];
  for (const concept of pool) {
    if (normalizeKey(concept.gloss_en) === key) return concept;
    if (normalizeKey(concept.gloss_zh) === key) return concept;
  }
  // `flesh / meat` 这类英文释义含斜杠，做一次主释义回退
  for (const concept of pool) {
    const primary = normalizeKey((concept.gloss_en ?? "").split("/")[0] ?? "");
    if (primary && primary === key) return concept;
  }
  return null;
}

/**
 * 扫描全部词条的概念标签，生成 dry-run 计划。
 *
 * `customConcepts` 为本工作区已有的自定义概念（用于解析 `概念:xxx`）。
 */
export function scanConceptTags(
  words: readonly WordEntry[],
  customConcepts: readonly ConceptDefinition[] = [],
): ConceptMigrationPlan {
  const candidates: ConceptTagCandidate[] = [];
  const suggested = new Map<string, ConceptDefinition>();

  for (const word of words) {
    const tags = word.metadata?.tags ?? [];
    if (tags.length === 0) continue;

    // 一个词条内所有概念标签必须指向同一概念，否则视为冲突
    const perEntry: {
      tag: string;
      rawValue: string;
      concept: ConceptDefinition | null;
      guessedByIndex: boolean;
    }[] = [];
    for (const tag of tags) {
      const rawValue = extractConceptTagValue(tag);
      if (rawValue === null) continue;
      const resolved = resolveConcept(rawValue, customConcepts);
      perEntry.push({
        tag,
        rawValue,
        concept: resolved.concept,
        guessedByIndex: resolved.guessedByIndex,
      });
    }
    if (perEntry.length === 0) continue;

    const resolvedIds = new Set(
      perEntry
        .map((item) => item.concept?.concept_id)
        .filter((id): id is string => typeof id === "string"),
    );
    const existing = word.senses.find((sense) => sense.concept_id)?.concept_id ?? null;
    const entryConflict =
      resolvedIds.size > 1
        ? [...resolvedIds].join(" / ")
        : existing && resolvedIds.size === 1 && !resolvedIds.has(existing)
          ? existing
          : undefined;

    for (const item of perEntry) {
      const conceptId = item.concept?.concept_id ?? null;
      let status: ConceptTagStatus;
      if (entryConflict) {
        status = "conflict";
      } else if (!conceptId) {
        status = "unresolved";
      } else if (existing === conceptId) {
        status = "already-applied";
      } else if (item.guessedByIndex) {
        // 纯数字标签只是按 Swadesh 序号猜测，禁止静默自动绑定
        status = "needs_confirm";
      } else {
        status = "resolved";
      }

      if (status === "unresolved") {
        const key = normalizeKey(item.rawValue);
        if (key && !suggested.has(key)) {
          suggested.set(key, {
            concept_id: slugifyConceptId(item.rawValue),
            gloss_en: item.rawValue,
            gloss_zh: item.rawValue,
            semantic_field: "culture",
            standard_lists: [],
          });
        }
      }

      candidates.push({
        entryId: word.entry_id,
        word: word.con_word_romanized,
        tag: item.tag,
        rawValue: item.rawValue,
        conceptId,
        label: item.concept?.gloss_zh || item.concept?.gloss_en || item.rawValue,
        status,
        conflictWith: entryConflict,
      });
    }
  }

  const pick = (status: ConceptTagStatus) =>
    candidates.filter((candidate) => candidate.status === status);

  return {
    candidates,
    resolved: pick("resolved"),
    needsConfirm: pick("needs_confirm"),
    conflicts: pick("conflict"),
    unresolved: pick("unresolved"),
    alreadyApplied: pick("already-applied"),
    suggestedConcepts: [...suggested.values()],
    hasWork: pick("resolved").length > 0 || suggested.size > 0,
  };
}

/** 概念 ID 规范化：保留字母数字与连字符，其余折叠为下划线 */
export function slugifyConceptId(value: string): string {
  const ascii = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  if (!ascii) return `custom_${Date.now().toString(36)}`;
  // 中文等非 ASCII 直接做 ID 不便于跨工具引用，改为哈希式短 ID
  if (/[^\x00-\x7F]/.test(ascii)) {
    let hash = 0;
    for (let i = 0; i < ascii.length; i += 1) {
      hash = (hash * 31 + ascii.charCodeAt(i)) >>> 0;
    }
    return `custom_${hash.toString(36)}`;
  }
  return ascii;
}

/**
 * 落地迁移计划（纯函数，返回新的词条数组）。
 *
 * - 只处理 `resolved`、显式勾选的 `needs_confirm` 与 `unresolved`
 *   （后者绑定到 `suggestedConcepts` 里的新 ID）；
 * - 未勾选的 `needs_confirm` 猜测项、`conflict` / `already-applied` 一律不动，
 *   保证幂等与不覆盖用户数据；
 * - `stripTags` 为真时移除已成功迁移的标签。
 */
export function applyConceptMigration(
  words: readonly WordEntry[],
  plan: ConceptMigrationPlan,
  options: ApplyConceptMigrationOptions = {},
): ConceptMigrationResult {
  const { stripTags = false, applyKeys } = options;
  const allowed = (candidate: ConceptTagCandidate) =>
    !applyKeys || applyKeys.has(candidateKey(candidate));

  const byEntry = new Map<string, ConceptTagCandidate[]>();
  const push = (candidate: ConceptTagCandidate) => {
    const list = byEntry.get(candidate.entryId) ?? [];
    list.push(candidate);
    byEntry.set(candidate.entryId, list);
  };

  for (const candidate of plan.resolved) {
    if (allowed(candidate)) push(candidate);
  }
  // 猜测项只有被显式勾选（出现在 applyKeys 中）时才落地
  for (const candidate of plan.needsConfirm) {
    if (applyKeys && applyKeys.has(candidateKey(candidate))) push(candidate);
  }

  // unresolved 标签按「值」映射到新建概念
  const suggestedByRaw = new Map<string, string>();
  for (const concept of plan.suggestedConcepts) {
    suggestedByRaw.set(normalizeKey(concept.gloss_en), concept.concept_id);
  }
  for (const candidate of plan.unresolved) {
    if (!allowed(candidate)) continue;
    const target = suggestedByRaw.get(normalizeKey(candidate.rawValue));
    if (!target) continue;
    push({ ...candidate, conceptId: target, status: "resolved" });
  }

  let changedEntries = 0;
  let strippedTags = 0;
  const nextWords = words.map((word) => {
    const candidates = byEntry.get(word.entry_id);
    if (!candidates || candidates.length === 0) return word;

    const conceptId = candidates[0].conceptId;
    if (!conceptId) return word;

    // core 层无 DOM/Node 全局类型，沿用 JSON 深拷贝（词条本身即 JSON 结构）
    const next = JSON.parse(JSON.stringify(word)) as WordEntry;
    let touched = false;

    // 绑定到首个义项（多义项共享概念是常见建模，后续可手动拆开）
    const sense = next.senses[0];
    if (sense && sense.concept_id !== conceptId) {
      sense.concept_id = conceptId;
      touched = true;
    }

    if (stripTags && next.metadata?.tags) {
      const migratedTags = new Set(candidates.map((candidate) => candidate.tag));
      const kept = next.metadata.tags.filter((tag) => !migratedTags.has(tag));
      if (kept.length !== next.metadata.tags.length) {
        strippedTags += next.metadata.tags.length - kept.length;
        next.metadata.tags = kept;
        touched = true;
      }
    }

    if (!touched) return word;
    changedEntries += 1;
    return next;
  });

  return {
    words: nextWords,
    customConcepts: plan.suggestedConcepts,
    changedEntries,
    strippedTags,
  };
}

// ── 全语系概念对齐与概念合并（Roadmap v3 / Pillar 4）──────────────────────

/** 跨语言概念对齐候选：精确到「词条 × 义项」，绝不仅绑首个义项 */
export interface ConceptSenseCandidate {
  languageId: string;
  entryId: string;
  senseId: string;
  romanized: string;
  ipa: string;
  gloss: string;
  posId: string;
  score: number;
  matchReason: "exact_gloss" | "alias" | "token" | "already_bound";
}

function tokenizeForMatching(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2);
}

interface ConceptMatchKeys {
  conceptId: string;
  exactGlosses: Set<string>;
  aliases: Set<string>;
  tokens: Set<string>;
}

function buildConceptMatchKeys(concept: ConceptDefinition): ConceptMatchKeys {
  const exactGlosses = new Set<string>();
  const aliases = new Set<string>();
  const tokens = new Set<string>();
  for (const gloss of [concept.gloss_en, concept.gloss_zh]) {
    const key = normalizeKey(gloss ?? "");
    if (key) exactGlosses.add(key);
  }
  for (const alias of concept.aliases ?? []) {
    const key = normalizeKey(alias);
    if (!key) continue;
    aliases.add(key);
    tokens.add(key);
  }
  for (const source of [concept.gloss_en, concept.gloss_zh, ...(concept.aliases ?? [])]) {
    for (const token of tokenizeForMatching(source ?? "")) {
      tokens.add(token);
    }
  }
  return { conceptId: concept.concept_id, exactGlosses, aliases, tokens };
}

/**
 * 全语系概念对齐自动建议（Roadmap v3 / Pillar 4.3）。
 *
 * 遍历每门语言每个词条的**每一个义项**（修复旧实现只看 `senses[0]` 的缺陷），
 * 按「已绑定 → 释义精确命中 → 概念别名命中 → 释义分词命中」四路打分，
 * 使 `zov` 的「五 / 手 / 拿住」三个义项分别进入 `five` / `hand` / `hold` 的候选。
 *
 * 返回 `conceptId → languageId → 候选列表`（按 score 降序，同分按词形稳定排序）。
 */
export function suggestCrossLanguageConceptAlignments(params: {
  concepts: ConceptDefinition[];
  languages: LanguageEntry[];
  wordsByLanguage: Record<string, WordEntry[]>;
  /** 每门语言每个概念最多返回多少条候选（UI 只需前几条，避免上万条候选拖垮渲染） */
  maxCandidatesPerLanguage?: number;
}): Record<string, Record<string, ConceptSenseCandidate[]>> {
  const { concepts, languages, wordsByLanguage, maxCandidatesPerLanguage } = params;
  const result: Record<string, Record<string, ConceptSenseCandidate[]>> = {};
  if (concepts.length === 0) return result;

  interface IndexedSense {
    word: WordEntry;
    sense: WordEntry["senses"][number];
    glossNorm: string;
    defNorms: string[];
    glossTokens: string[];
    defTokens: string[];
  }

  interface LanguageIndex {
    byConceptId: Map<string, IndexedSense[]>;
    byGloss: Map<string, IndexedSense[]>;
    byDef: Map<string, IndexedSense[]>;
    byGlossToken: Map<string, IndexedSense[]>;
    byDefToken: Map<string, IndexedSense[]>;
  }

  const pushTo = <T,>(map: Map<string, T[]>, key: string, value: T): void => {
    const bucket = map.get(key);
    if (bucket) bucket.push(value);
    else map.set(key, [value]);
  };

  /** 每门语言只建一次倒排索引：按概念 id / 整条释义 / 释义分词 / 定义分词 */
  const indexes = new Map<string, LanguageIndex>();
  for (const language of languages) {
    const index: LanguageIndex = {
      byConceptId: new Map(),
      byGloss: new Map(),
      byDef: new Map(),
      byGlossToken: new Map(),
      byDefToken: new Map(),
    };
    for (const word of wordsByLanguage[language.language_id] ?? []) {
      for (const sense of word.senses) {
        const glossNorm = normalizeKey(sense.gloss ?? "");
        if (!glossNorm) continue;
        const defNorms = (sense.definitions ?? []).map((def) => normalizeKey(def));
        const glossTokens = tokenizeForMatching(sense.gloss ?? "");
        const defTokens = (sense.definitions ?? []).flatMap((def) => tokenizeForMatching(def));
        const entry: IndexedSense = { word, sense, glossNorm, defNorms, glossTokens, defTokens };
        if (sense.concept_id) pushTo(index.byConceptId, sense.concept_id, entry);
        pushTo(index.byGloss, glossNorm, entry);
        for (const defNorm of new Set(defNorms)) pushTo(index.byDef, defNorm, entry);
        for (const token of new Set(glossTokens)) pushTo(index.byGlossToken, token, entry);
        for (const token of new Set(defTokens)) pushTo(index.byDefToken, token, entry);
      }
    }
    indexes.set(language.language_id, index);
  }

  for (const concept of concepts) {
    const keys = buildConceptMatchKeys(concept);
    const perLanguage: Record<string, ConceptSenseCandidate[]> = {};

    for (const language of languages) {
      const index = indexes.get(language.language_id);
      if (!index) continue;

      // 只把「可能命中」的义项取出来复核，避免对全词典做全量扫描
      const gathered = new Set<IndexedSense>();
      const collect = (bucket: IndexedSense[] | undefined) => {
        if (!bucket) return;
        for (const entry of bucket) gathered.add(entry);
      };
      collect(index.byConceptId.get(keys.conceptId));
      for (const gloss of keys.exactGlosses) collect(index.byGloss.get(gloss));
      for (const alias of keys.aliases) {
        collect(index.byGloss.get(alias));
        collect(index.byDef.get(alias));
      }
      for (const token of keys.tokens) {
        collect(index.byGlossToken.get(token));
        collect(index.byDefToken.get(token));
      }

      const limit = maxCandidatesPerLanguage ?? 0;
      const candidates: ConceptSenseCandidate[] = [];
      /** 有上限时维持「按分数/词形有序的前 K 条」，避免对上万条候选做全量排序 */
      const keepCandidate = (candidate: ConceptSenseCandidate) => {
        if (limit <= 0) {
          candidates.push(candidate);
          return;
        }
        let index = candidates.length;
        while (index > 0) {
          const prev = candidates[index - 1] as ConceptSenseCandidate;
          const better =
            candidate.score > prev.score ||
            (candidate.score === prev.score &&
              (candidate.romanized < prev.romanized ||
                (candidate.romanized === prev.romanized && candidate.senseId < prev.senseId)));
          if (!better) break;
          index -= 1;
        }
        if (index >= limit) return;
        candidates.splice(index, 0, candidate);
        if (candidates.length > limit) candidates.length = limit;
      };

      for (const entry of gathered) {
        const { word, sense, glossNorm, defNorms, glossTokens, defTokens } = entry;
        let score = 0;
        let matchReason: ConceptSenseCandidate["matchReason"] | null = null;

        if (sense.concept_id === keys.conceptId) {
          score = 100;
          matchReason = "already_bound";
        } else if (keys.exactGlosses.has(glossNorm)) {
          score = 90;
          matchReason = "exact_gloss";
        } else if (
          keys.aliases.has(glossNorm) ||
          defNorms.some((defNorm) => keys.aliases.has(defNorm))
        ) {
          score = 75;
          matchReason = "alias";
        } else if (glossTokens.some((token) => keys.tokens.has(token))) {
          score = 60;
          matchReason = "token";
        } else if (defTokens.some((token) => keys.tokens.has(token))) {
          score = 50;
          matchReason = "token";
        }

        if (matchReason === null) continue;
        keepCandidate({
          languageId: language.language_id,
          entryId: word.entry_id,
          senseId: sense.sense_id,
          romanized: word.con_word_romanized,
          ipa: word.phonetic_ipa ?? "",
          gloss: sense.gloss ?? "",
          posId: sense.pos_id ?? "",
          score,
          matchReason,
        });
      }

      if (limit <= 0) {
        candidates.sort((a, b) => {
          if (a.score !== b.score) return b.score - a.score;
          const byForm = a.romanized.localeCompare(b.romanized);
          if (byForm !== 0) return byForm;
          return a.senseId.localeCompare(b.senseId);
        });
      }
      if (candidates.length > 0) perLanguage[language.language_id] = candidates;
    }

    result[concept.concept_id] = perLanguage;
  }

  return result;
}

/**
 * 预览自定义概念合并（Roadmap v3 / Pillar 4.4）。
 *
 * 返回合并后的概念表（源概念被移除、别名并入目标概念）与受影响的全部
 * 词典义项绑定列表（`concept_id === sourceConceptId` 的义项，跨全部语言）。
 * 纯预览：不修改词条数据；实际重写由调用方（MCP 事务 / UI 批量写）执行。
 */
export function previewMergeCustomConcepts(params: {
  sourceConceptId: string;
  targetConceptId: string;
  customConcepts: ConceptDefinition[];
  wordsByLanguage: Record<string, WordEntry[]>;
}): {
  nextConcepts: ConceptDefinition[];
  affectedBindings: Array<{
    languageId: string;
    entryId: string;
    senseId: string;
    romanized: string;
  }>;
} {
  const { sourceConceptId, targetConceptId, customConcepts, wordsByLanguage } = params;

  const affectedBindings: Array<{
    languageId: string;
    entryId: string;
    senseId: string;
    romanized: string;
  }> = [];

  if (sourceConceptId !== targetConceptId) {
    for (const [languageId, words] of Object.entries(wordsByLanguage)) {
      for (const word of words) {
        for (const sense of word.senses) {
          if (sense.concept_id !== sourceConceptId) continue;
          affectedBindings.push({
            languageId,
            entryId: word.entry_id,
            senseId: sense.sense_id,
            romanized: word.con_word_romanized,
          });
        }
      }
    }
  }

  const source = customConcepts.find((concept) => concept.concept_id === sourceConceptId);
  const target = customConcepts.find((concept) => concept.concept_id === targetConceptId);

  if (!source || !target || sourceConceptId === targetConceptId) {
    // 源/目标不在自定义概念表（例如目标为核心概念）或本就是同一概念：概念表不变
    return {
      nextConcepts: customConcepts.map((concept) => ({ ...concept })),
      affectedBindings,
    };
  }

  const mergedAliases = [...new Set([...(target.aliases ?? []), ...(source.aliases ?? [])])];
  const mergedLists = [
    ...new Set([...(target.standard_lists ?? []), ...(source.standard_lists ?? [])]),
  ];

  const nextConcepts = customConcepts
    .filter((concept) => concept.concept_id !== sourceConceptId)
    .map((concept): ConceptDefinition => {
      if (concept.concept_id !== targetConceptId) return { ...concept };
      return {
        ...concept,
        standard_lists: mergedLists as ConceptDefinition["standard_lists"],
        ...(concept.concepticon_id
          ? {}
          : source.concepticon_id
            ? { concepticon_id: source.concepticon_id }
            : {}),
        ...(mergedAliases.length > 0 ? { aliases: mergedAliases } : {}),
      };
    });

  return { nextConcepts, affectedBindings };
}
