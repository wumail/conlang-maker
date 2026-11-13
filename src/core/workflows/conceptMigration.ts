/**
 * conceptMigration.ts — 旧式「概念标签」到 `Sense.concept_id` 的迁移工作流
 *
 * 历史工作区常把概念写进 `metadata.tags`（`概念:水` / `概念12` / `concept:water`）。
 * 本模块把这些标签解析成标准概念锚点，产出可预览的 dry-run 计划，再由
 * `applyConceptMigration` 纯函数落地——**幂等**：重复执行不会产生新变更。
 */
import type { ConceptDefinition, WordEntry } from "../../types";
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
