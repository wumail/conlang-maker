/**
 * core_concepts.ts — 内置核心概念库
 *
 * 以 Swadesh-100 与 Leipzig-Jakarta 100 为骨架合并去重，并补充一批通用
 * 文化/亲属/家畜概念，供词典义项挂载跨语言概念锚点（T2.2）。
 *
 * 约定：
 * - `concept_id` 为稳定的小写 ASCII 标识（不含空格），一旦发布不可更名；
 * - `standard_lists` 仅标注该概念确实出现在对应标准表中，未列入者视为
 *   「核心库扩展概念」；
 * - `concepticon_id` 留空——Concepticon 编号需从官方数据集导入，硬编码
 *   猜测值会污染后续对齐，故本文件不臆造。
 */
import type { ConceptDefinition } from "../types";

export type SemanticField =
  | "pronoun"
  | "person"
  | "kinship"
  | "body"
  | "animal"
  | "plant"
  | "nature"
  | "substance"
  | "action"
  | "motion"
  | "cognition"
  | "perception"
  | "property"
  | "quantity"
  | "culture"
  | "place";

interface ConceptSeed {
  id: string;
  en: string;
  zh: string;
  field: SemanticField;
  lists?: ("swadesh_100" | "leipzig_jakarta_100")[];
}

const S = "swadesh_100" as const;
const L = "leipzig_jakarta_100" as const;

const SEEDS: ConceptSeed[] = [
  // ── 代词与功能词 ─────────────────────────────────────────────────
  { id: "i", en: "I", zh: "我", field: "pronoun", lists: [S, L] },
  { id: "you", en: "you", zh: "你", field: "pronoun", lists: [S, L] },
  { id: "we", en: "we", zh: "我们", field: "pronoun", lists: [S] },
  { id: "this", en: "this", zh: "这", field: "pronoun", lists: [S, L] },
  { id: "that", en: "that", zh: "那", field: "pronoun", lists: [S] },
  { id: "who", en: "who", zh: "谁", field: "pronoun", lists: [S, L] },
  { id: "what", en: "what", zh: "什么", field: "pronoun", lists: [S] },
  { id: "not", en: "not", zh: "不", field: "pronoun", lists: [S, L] },

  // ── 数量 ─────────────────────────────────────────────────────────
  { id: "all", en: "all", zh: "全部", field: "quantity", lists: [S] },
  { id: "many", en: "many", zh: "多", field: "quantity", lists: [S] },
  { id: "one", en: "one", zh: "一", field: "quantity", lists: [S, L] },
  { id: "two", en: "two", zh: "二", field: "quantity", lists: [S] },
  { id: "three", en: "three", zh: "三", field: "quantity" },
  { id: "few", en: "few", zh: "少", field: "quantity" },

  // ── 人 ───────────────────────────────────────────────────────────
  { id: "person", en: "person", zh: "人", field: "person", lists: [S, L] },
  { id: "man", en: "man", zh: "男人", field: "person", lists: [S] },
  { id: "woman", en: "woman", zh: "女人", field: "person", lists: [S, L] },
  { id: "child", en: "child", zh: "孩子", field: "person", lists: [L] },

  // ── 亲属 ─────────────────────────────────────────────────────────
  { id: "mother", en: "mother", zh: "母亲", field: "kinship" },
  { id: "father", en: "father", zh: "父亲", field: "kinship" },
  { id: "sibling", en: "sibling", zh: "兄弟姐妹", field: "kinship" },
  { id: "grandparent", en: "grandparent", zh: "祖父母", field: "kinship" },

  // ── 身体 ─────────────────────────────────────────────────────────
  { id: "head", en: "head", zh: "头", field: "body", lists: [S, L] },
  { id: "hair", en: "hair", zh: "头发", field: "body", lists: [S, L] },
  { id: "ear", en: "ear", zh: "耳朵", field: "body", lists: [S, L] },
  { id: "eye", en: "eye", zh: "眼睛", field: "body", lists: [S, L] },
  { id: "nose", en: "nose", zh: "鼻子", field: "body", lists: [S, L] },
  { id: "mouth", en: "mouth", zh: "嘴", field: "body", lists: [S, L] },
  { id: "tooth", en: "tooth", zh: "牙齿", field: "body", lists: [S, L] },
  { id: "tongue", en: "tongue", zh: "舌头", field: "body", lists: [S, L] },
  { id: "neck", en: "neck", zh: "脖子", field: "body", lists: [S, L] },
  { id: "breast", en: "breast", zh: "乳房", field: "body", lists: [S, L] },
  { id: "belly", en: "belly", zh: "肚子", field: "body", lists: [S] },
  { id: "hand", en: "hand", zh: "手", field: "body", lists: [S] },
  { id: "arm", en: "arm", zh: "手臂", field: "body", lists: [L] },
  { id: "foot", en: "foot", zh: "脚", field: "body", lists: [S] },
  { id: "knee", en: "knee", zh: "膝盖", field: "body", lists: [S] },
  { id: "heart", en: "heart", zh: "心", field: "body", lists: [S] },
  { id: "liver", en: "liver", zh: "肝", field: "body", lists: [S] },
  { id: "bone", en: "bone", zh: "骨头", field: "body", lists: [S, L] },
  { id: "blood", en: "blood", zh: "血", field: "body", lists: [S, L] },
  { id: "flesh", en: "flesh / meat", zh: "肉", field: "body", lists: [S, L] },
  { id: "skin", en: "skin", zh: "皮肤", field: "body", lists: [S, L] },
  { id: "horn", en: "horn", zh: "角", field: "body", lists: [S] },
  { id: "tail", en: "tail", zh: "尾巴", field: "body", lists: [S, L] },
  { id: "feather", en: "feather", zh: "羽毛", field: "body", lists: [S] },
  { id: "wing", en: "wing", zh: "翅膀", field: "body", lists: [L] },
  { id: "claw", en: "claw", zh: "爪", field: "body", lists: [S] },
  { id: "louse", en: "louse", zh: "虱子", field: "body", lists: [S, L] },
  { id: "egg", en: "egg", zh: "蛋", field: "body", lists: [S, L] },
  { id: "grease", en: "grease", zh: "油脂", field: "substance", lists: [S] },

  // ── 动物 ─────────────────────────────────────────────────────────
  { id: "fish", en: "fish", zh: "鱼", field: "animal", lists: [S, L] },
  { id: "bird", en: "bird", zh: "鸟", field: "animal", lists: [S] },
  { id: "dog", en: "dog", zh: "狗", field: "animal", lists: [S, L] },
  { id: "horse", en: "horse", zh: "马", field: "animal" },
  { id: "cow", en: "cow", zh: "牛", field: "animal" },
  { id: "pig", en: "pig", zh: "猪", field: "animal" },
  { id: "sheep", en: "sheep", zh: "羊", field: "animal" },
  { id: "snake", en: "snake", zh: "蛇", field: "animal" },

  // ── 植物 ─────────────────────────────────────────────────────────
  { id: "tree", en: "tree", zh: "树", field: "plant", lists: [S, L] },
  { id: "seed", en: "seed", zh: "种子", field: "plant", lists: [S, L] },
  { id: "leaf", en: "leaf", zh: "叶子", field: "plant", lists: [S, L] },
  { id: "root", en: "root", zh: "根", field: "plant", lists: [S, L] },
  { id: "bark", en: "bark", zh: "树皮", field: "plant", lists: [S] },
  { id: "grass", en: "grass", zh: "草", field: "plant", lists: [L] },
  { id: "flower", en: "flower", zh: "花", field: "plant" },
  { id: "fruit", en: "fruit", zh: "果实", field: "plant" },

  // ── 自然 ─────────────────────────────────────────────────────────
  { id: "sun", en: "sun", zh: "太阳", field: "nature", lists: [S, L] },
  { id: "moon", en: "moon", zh: "月亮", field: "nature", lists: [S, L] },
  { id: "star", en: "star", zh: "星星", field: "nature", lists: [S, L] },
  { id: "sky", en: "sky", zh: "天空", field: "nature", lists: [L] },
  { id: "water", en: "water", zh: "水", field: "nature", lists: [S, L] },
  { id: "rain", en: "rain", zh: "雨", field: "nature", lists: [S, L] },
  { id: "stone", en: "stone / rock", zh: "石头", field: "nature", lists: [S, L] },
  { id: "sand", en: "sand", zh: "沙", field: "nature", lists: [S] },
  { id: "earth", en: "earth / soil", zh: "土地", field: "nature", lists: [S, L] },
  { id: "cloud", en: "cloud", zh: "云", field: "nature", lists: [S] },
  { id: "smoke", en: "smoke", zh: "烟", field: "nature", lists: [S, L] },
  { id: "fire", en: "fire", zh: "火", field: "nature", lists: [S, L] },
  { id: "ash", en: "ash", zh: "灰", field: "nature", lists: [S, L] },
  { id: "mountain", en: "mountain", zh: "山", field: "nature", lists: [S] },
  { id: "river", en: "river", zh: "河", field: "nature" },
  { id: "sea", en: "sea", zh: "海", field: "nature" },
  { id: "wind", en: "wind", zh: "风", field: "nature" },
  { id: "night", en: "night", zh: "夜晚", field: "nature", lists: [S, L] },

  // ── 物质 ─────────────────────────────────────────────────────────
  { id: "salt", en: "salt", zh: "盐", field: "substance" },
  { id: "milk", en: "milk", zh: "奶", field: "substance" },
  { id: "honey", en: "honey", zh: "蜂蜜", field: "substance" },

  // ── 动作 ─────────────────────────────────────────────────────────
  { id: "drink", en: "drink", zh: "喝", field: "action", lists: [S, L] },
  { id: "eat", en: "eat", zh: "吃", field: "action", lists: [S, L] },
  { id: "bite", en: "bite", zh: "咬", field: "action", lists: [S] },
  { id: "see", en: "see", zh: "看见", field: "perception", lists: [S, L] },
  { id: "hear", en: "hear", zh: "听见", field: "perception", lists: [S, L] },
  { id: "know", en: "know", zh: "知道", field: "cognition", lists: [S, L] },
  { id: "think", en: "think", zh: "想", field: "cognition", lists: [L] },
  { id: "sleep", en: "sleep", zh: "睡", field: "action", lists: [S, L] },
  { id: "die", en: "die", zh: "死", field: "action", lists: [S, L] },
  { id: "kill", en: "kill", zh: "杀", field: "action", lists: [S, L] },
  { id: "swim", en: "swim", zh: "游泳", field: "motion", lists: [S, L] },
  { id: "fly", en: "fly", zh: "飞", field: "motion", lists: [S, L] },
  { id: "walk", en: "walk", zh: "走", field: "motion", lists: [S, L] },
  { id: "come", en: "come", zh: "来", field: "motion", lists: [S, L] },
  { id: "sit", en: "sit", zh: "坐", field: "motion", lists: [S, L] },
  { id: "stand", en: "stand", zh: "站", field: "motion", lists: [S, L] },
  { id: "lie", en: "lie (recline)", zh: "躺", field: "motion", lists: [S] },
  { id: "fall", en: "fall", zh: "落", field: "motion", lists: [L] },
  { id: "flow", en: "flow", zh: "流", field: "motion", lists: [L] },
  { id: "give", en: "give", zh: "给", field: "action", lists: [S, L] },
  { id: "say", en: "say", zh: "说", field: "action", lists: [S, L] },
  { id: "burn", en: "burn", zh: "烧", field: "action", lists: [S, L] },
  { id: "breathe", en: "breathe", zh: "呼吸", field: "action", lists: [L] },
  { id: "laugh", en: "laugh", zh: "笑", field: "action", lists: [L] },
  { id: "sing", en: "sing", zh: "唱", field: "action", lists: [L] },
  { id: "sew", en: "sew", zh: "缝", field: "action", lists: [L] },
  { id: "spit", en: "spit", zh: "吐", field: "action", lists: [L] },
  { id: "live", en: "live", zh: "活", field: "action", lists: [L] },
  { id: "make", en: "do / make", zh: "做", field: "action", lists: [L] },
  { id: "name", en: "name", zh: "名字", field: "cognition", lists: [S, L] },

  // ── 性质 ─────────────────────────────────────────────────────────
  { id: "big", en: "big", zh: "大", field: "property", lists: [S, L] },
  { id: "long", en: "long", zh: "长", field: "property", lists: [S] },
  { id: "small", en: "small", zh: "小", field: "property", lists: [S, L] },
  { id: "red", en: "red", zh: "红", field: "property", lists: [S, L] },
  { id: "green", en: "green", zh: "绿", field: "property", lists: [S] },
  { id: "yellow", en: "yellow", zh: "黄", field: "property", lists: [S] },
  { id: "white", en: "white", zh: "白", field: "property", lists: [S, L] },
  { id: "black", en: "black", zh: "黑", field: "property", lists: [S, L] },
  { id: "hot", en: "hot", zh: "热", field: "property", lists: [S, L] },
  { id: "cold", en: "cold", zh: "冷", field: "property", lists: [S, L] },
  { id: "full", en: "full", zh: "满", field: "property", lists: [S] },
  { id: "new", en: "new", zh: "新", field: "property", lists: [S, L] },
  { id: "good", en: "good", zh: "好", field: "property", lists: [S] },
  { id: "round", en: "round", zh: "圆", field: "property", lists: [S] },
  { id: "dry", en: "dry", zh: "干", field: "property", lists: [S] },
  { id: "far", en: "far", zh: "远", field: "property", lists: [L] },
  { id: "bitter", en: "bitter", zh: "苦", field: "property", lists: [L] },

  // ── 文化与器物 ───────────────────────────────────────────────────
  { id: "house", en: "house", zh: "房子", field: "place", lists: [L] },
  { id: "path", en: "path", zh: "路", field: "place", lists: [S] },
  { id: "village", en: "village", zh: "村庄", field: "place" },
  { id: "field", en: "field", zh: "田地", field: "place" },
  { id: "rope", en: "rope", zh: "绳", field: "culture" },
  { id: "knife", en: "knife", zh: "刀", field: "culture" },
  { id: "bow", en: "bow", zh: "弓", field: "culture" },
  { id: "arrow", en: "arrow", zh: "箭", field: "culture" },
  { id: "cloth", en: "cloth", zh: "布", field: "culture" },
];

/** 语义域展示顺序 */
export const SEMANTIC_FIELDS: readonly SemanticField[] = [
  "pronoun",
  "person",
  "kinship",
  "body",
  "animal",
  "plant",
  "nature",
  "substance",
  "action",
  "motion",
  "cognition",
  "perception",
  "property",
  "quantity",
  "culture",
  "place",
] as const;

export const CORE_CONCEPTS: readonly ConceptDefinition[] = SEEDS.map((seed) => ({
  concept_id: seed.id,
  gloss_en: seed.en,
  gloss_zh: seed.zh,
  semantic_field: seed.field,
  standard_lists: seed.lists ? [...seed.lists] : [],
}));

const BY_ID = new Map(CORE_CONCEPTS.map((concept) => [concept.concept_id, concept]));

export function getCoreConcept(conceptId: string): ConceptDefinition | undefined {
  return BY_ID.get(conceptId);
}

export interface ConceptSearchOptions {
  /** 限定语义域 */
  field?: SemanticField | "";
  /** 结果上限（默认 40） */
  limit?: number;
  /** 追加的自定义概念（工作区） */
  extra?: readonly ConceptDefinition[];
}

export interface ConceptSearchHit {
  concept: ConceptDefinition;
  /** 命中的字段，用于 UI 标注匹配来源 */
  matchedOn: "id" | "zh" | "en" | "field";
  isCustom: boolean;
}

/**
 * 概念检索：支持 `concept_id`、中文释义、英文释义与语义域名称/标签。
 * 空查询返回按语义域排序的全量前 `limit` 条。
 */
export function searchConcepts(
  query: string,
  options: ConceptSearchOptions = {},
): ConceptSearchHit[] {
  const { field = "", limit = 40, extra = [] } = options;
  const coreIds = new Set(CORE_CONCEPTS.map((concept) => concept.concept_id));
  const pool: { concept: ConceptDefinition; isCustom: boolean }[] = [
    ...CORE_CONCEPTS.map((concept) => ({ concept, isCustom: false })),
    ...extra
      .filter((concept) => !coreIds.has(concept.concept_id))
      .map((concept) => ({ concept, isCustom: true })),
  ];

  const filtered = field
    ? pool.filter((item) => item.concept.semantic_field === field)
    : pool;

  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return filtered.slice(0, limit).map((item) => ({ ...item, matchedOn: "id" }));
  }

  const hits: ConceptSearchHit[] = [];
  for (const item of filtered) {
    const { concept } = item;
    const id = concept.concept_id.toLowerCase();
    const zh = (concept.gloss_zh ?? "").toLowerCase();
    const en = (concept.gloss_en ?? "").toLowerCase();
    const fld = (concept.semantic_field ?? "").toLowerCase();

    let matchedOn: ConceptSearchHit["matchedOn"] | null = null;
    if (id === normalized) matchedOn = "id";
    else if (zh === normalized) matchedOn = "zh";
    else if (en === normalized) matchedOn = "en";
    else if (fld === normalized) matchedOn = "field";
    else if (id.includes(normalized)) matchedOn = "id";
    else if (zh.includes(normalized)) matchedOn = "zh";
    else if (en.includes(normalized)) matchedOn = "en";

    if (matchedOn) hits.push({ ...item, matchedOn });
  }

  const rank: Record<ConceptSearchHit["matchedOn"], number> = {
    id: 0,
    zh: 1,
    en: 2,
    field: 3,
  };
  hits.sort((a, b) => {
    const diff = rank[a.matchedOn] - rank[b.matchedOn];
    if (diff !== 0) return diff;
    return a.concept.concept_id.localeCompare(b.concept.concept_id);
  });
  return hits.slice(0, limit);
}
