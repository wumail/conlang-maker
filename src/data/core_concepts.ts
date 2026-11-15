/**
 * core_concepts.ts — 内置核心概念库
 *
 * 以 Swadesh-100 与 Leipzig-Jakarta 100 为骨架合并去重，并补充一批通用
 * 文化/亲属/家畜概念，供词典义项挂载跨语言概念锚点（T2.2）。
 *
 * 约定：
 * - `concept_id` 为稳定的小写 ASCII 标识（不含空格），一旦发布不可更名；
 * - `standard_lists` 仅标注该概念确实出现在对应标准表中，未列入者视为
 *   「核心库扩展概念」；两张标准表各自精确收录 100 条；
 * - `concepticon_id` 为 Concepticon（CLDF）官方概念编号，用于与外部
 *   数据集对齐；仅标准表概念填写，核心库扩展概念留空。
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
  /** Concepticon（CLDF）标准编号；标准表概念必填 */
  concepticonId?: string;
}

const S = "swadesh_100" as const;
const L = "leipzig_jakarta_100" as const;

const SEEDS: ConceptSeed[] = [
  // ── 代词与功能词 ─────────────────────────────────────────────────
  { id: "i", en: "I", zh: "我", field: "pronoun", lists: [S, L], concepticonId: "1209" },
  { id: "you", en: "you", zh: "你", field: "pronoun", lists: [S, L], concepticonId: "1215" },
  { id: "you_plural", en: "you (plural)", zh: "你们", field: "pronoun", lists: [L], concepticonId: "1213" },
  { id: "he", en: "he / she / it", zh: "他/她/它", field: "pronoun", lists: [L], concepticonId: "1211" },
  { id: "we", en: "we", zh: "我们", field: "pronoun", lists: [S], concepticonId: "1212" },
  { id: "this", en: "this", zh: "这", field: "pronoun", lists: [S, L], concepticonId: "1214" },
  { id: "that", en: "that", zh: "那", field: "pronoun", lists: [S], concepticonId: "78" },
  { id: "who", en: "who", zh: "谁", field: "pronoun", lists: [S, L], concepticonId: "1235" },
  { id: "what", en: "what", zh: "什么", field: "pronoun", lists: [S], concepticonId: "1236" },
  { id: "not", en: "not", zh: "不", field: "pronoun", lists: [S, L], concepticonId: "1240" },

  // ── 数量 ─────────────────────────────────────────────────────────
  { id: "all", en: "all", zh: "全部", field: "quantity", lists: [S], concepticonId: "98" },
  { id: "many", en: "many", zh: "多", field: "quantity", lists: [S], concepticonId: "1198" },
  { id: "one", en: "one", zh: "一", field: "quantity", lists: [S, L], concepticonId: "1493" },
  { id: "two", en: "two", zh: "二", field: "quantity", lists: [S], concepticonId: "1498" },
  { id: "three", en: "three", zh: "三", field: "quantity", concepticonId: "492" },
  { id: "few", en: "few", zh: "少", field: "quantity", concepticonId: "1244" },

  // ── 人 ───────────────────────────────────────────────────────────
  { id: "person", en: "person", zh: "人", field: "person", lists: [S, L], concepticonId: "683" },
  { id: "man", en: "man", zh: "男人", field: "person", lists: [S], concepticonId: "1554" },
  { id: "woman", en: "woman", zh: "女人", field: "person", lists: [S, L], concepticonId: "962" },
  { id: "child", en: "child", zh: "孩子", field: "person", lists: [L], concepticonId: "1304" },

  // ── 亲属 ─────────────────────────────────────────────────────────
  { id: "mother", en: "mother", zh: "母亲", field: "kinship", concepticonId: "1216" },
  { id: "father", en: "father", zh: "父亲", field: "kinship", concepticonId: "1217" },
  { id: "sibling", en: "sibling", zh: "兄弟姐妹", field: "kinship", concepticonId: "1640" },
  { id: "grandparent", en: "grandparent", zh: "祖父母", field: "kinship" },

  // ── 身体 ─────────────────────────────────────────────────────────
  { id: "head", en: "head", zh: "头", field: "body", lists: [S, L], concepticonId: "1256" },
  { id: "hair", en: "hair", zh: "头发", field: "body", lists: [S, L], concepticonId: "1040" },
  { id: "ear", en: "ear", zh: "耳朵", field: "body", lists: [S, L], concepticonId: "1247" },
  { id: "eye", en: "eye", zh: "眼睛", field: "body", lists: [S, L], concepticonId: "1248" },
  { id: "nose", en: "nose", zh: "鼻子", field: "body", lists: [S, L], concepticonId: "1221" },
  { id: "mouth", en: "mouth", zh: "嘴", field: "body", lists: [S, L], concepticonId: "674" },
  { id: "tooth", en: "tooth", zh: "牙齿", field: "body", lists: [S, L], concepticonId: "1380" },
  { id: "tongue", en: "tongue", zh: "舌头", field: "body", lists: [S, L], concepticonId: "1205" },
  { id: "neck", en: "neck", zh: "脖子", field: "body", lists: [S, L], concepticonId: "1333" },
  { id: "breast", en: "breast", zh: "乳房", field: "body", lists: [S, L], concepticonId: "1402" },
  { id: "belly", en: "belly", zh: "肚子", field: "body", lists: [S], concepticonId: "1838" },
  { id: "hand", en: "hand", zh: "手", field: "body", lists: [S], concepticonId: "1277" },
  { id: "arm", en: "arm", zh: "手臂", field: "body", lists: [L], concepticonId: "1673" },
  { id: "foot", en: "foot", zh: "脚", field: "body", lists: [S], concepticonId: "1301" },
  { id: "knee", en: "knee", zh: "膝盖", field: "body", lists: [S], concepticonId: "1371" },
  { id: "heart", en: "heart", zh: "心", field: "body", lists: [S], concepticonId: "1223" },
  { id: "liver", en: "liver", zh: "肝", field: "body", lists: [S], concepticonId: "1224" },
  { id: "bone", en: "bone", zh: "骨头", field: "body", lists: [S, L], concepticonId: "1394" },
  { id: "blood", en: "blood", zh: "血", field: "body", lists: [S, L], concepticonId: "946" },
  { id: "flesh", en: "flesh / meat", zh: "肉", field: "body", lists: [S, L], concepticonId: "2615" },
  { id: "skin", en: "skin", zh: "皮肤", field: "body", lists: [S, L], concepticonId: "763" },
  { id: "horn", en: "horn", zh: "角", field: "body", lists: [S], concepticonId: "1393" },
  { id: "tail", en: "tail", zh: "尾巴", field: "body", lists: [S, L], concepticonId: "1220" },
  { id: "feather", en: "feather", zh: "羽毛", field: "body", lists: [S], concepticonId: "1201" },
  { id: "wing", en: "wing", zh: "翅膀", field: "body", lists: [L], concepticonId: "490" },
  { id: "claw", en: "claw", zh: "爪", field: "body", lists: [S], concepticonId: "72" },
  { id: "louse", en: "louse", zh: "虱子", field: "body", lists: [S, L], concepticonId: "1392" },
  { id: "egg", en: "egg", zh: "蛋", field: "body", lists: [S, L], concepticonId: "744" },
  { id: "grease", en: "grease", zh: "油脂", field: "substance", lists: [S], concepticonId: "1282" },

  // ── 动物 ─────────────────────────────────────────────────────────
  { id: "fish", en: "fish", zh: "鱼", field: "animal", lists: [S, L], concepticonId: "227" },
  { id: "bird", en: "bird", zh: "鸟", field: "animal", lists: [S], concepticonId: "937" },
  { id: "dog", en: "dog", zh: "狗", field: "animal", lists: [S, L], concepticonId: "2009" },
  { id: "horse", en: "horse", zh: "马", field: "animal", concepticonId: "615" },
  { id: "cow", en: "cow", zh: "牛", field: "animal", concepticonId: "1007" },
  { id: "pig", en: "pig", zh: "猪", field: "animal", concepticonId: "1337" },
  { id: "sheep", en: "sheep", zh: "羊", field: "animal", concepticonId: "1331" },
  { id: "snake", en: "snake", zh: "蛇", field: "animal", concepticonId: "730" },

  // ── 植物 ─────────────────────────────────────────────────────────
  { id: "tree", en: "tree", zh: "树", field: "plant", lists: [S, L], concepticonId: "906" },
  { id: "seed", en: "seed", zh: "种子", field: "plant", lists: [S, L], concepticonId: "714" },
  { id: "leaf", en: "leaf", zh: "叶子", field: "plant", lists: [S, L], concepticonId: "628" },
  { id: "root", en: "root", zh: "根", field: "plant", lists: [S, L], concepticonId: "670" },
  { id: "bark", en: "bark", zh: "树皮", field: "plant", lists: [S], concepticonId: "1204" },
  { id: "grass", en: "grass", zh: "草", field: "plant", lists: [L], concepticonId: "606" },
  { id: "flower", en: "flower", zh: "花", field: "plant", concepticonId: "239" },
  { id: "fruit", en: "fruit", zh: "果实", field: "plant", concepticonId: "1507" },

  // ── 自然 ─────────────────────────────────────────────────────────
  { id: "sun", en: "sun", zh: "太阳", field: "nature", lists: [S, L], concepticonId: "1343" },
  { id: "moon", en: "moon", zh: "月亮", field: "nature", lists: [S, L], concepticonId: "1313" },
  { id: "star", en: "star", zh: "星星", field: "nature", lists: [S, L], concepticonId: "1430" },
  { id: "sky", en: "sky", zh: "天空", field: "nature", lists: [L], concepticonId: "1732" },
  { id: "day", en: "day", zh: "白天", field: "nature", lists: [L], concepticonId: "1225" },
  { id: "year", en: "year", zh: "年", field: "nature", lists: [L], concepticonId: "1226" },
  { id: "water", en: "water", zh: "水", field: "nature", lists: [S, L], concepticonId: "948" },
  { id: "rain", en: "rain", zh: "雨", field: "nature", lists: [S, L], concepticonId: "658" },
  { id: "stone", en: "stone / rock", zh: "石头", field: "nature", lists: [S, L], concepticonId: "857" },
  { id: "sand", en: "sand", zh: "沙", field: "nature", lists: [S], concepticonId: "671" },
  { id: "earth", en: "earth / soil", zh: "土地", field: "nature", lists: [S, L], concepticonId: "1228" },
  { id: "cloud", en: "cloud", zh: "云", field: "nature", lists: [S], concepticonId: "1489" },
  { id: "smoke", en: "smoke", zh: "烟", field: "nature", lists: [S, L], concepticonId: "778" },
  { id: "fire", en: "fire", zh: "火", field: "nature", lists: [S, L], concepticonId: "221" },
  { id: "ash", en: "ash", zh: "灰", field: "nature", lists: [S, L], concepticonId: "1813" },
  { id: "mountain", en: "mountain", zh: "山", field: "nature", lists: [S], concepticonId: "639" },
  { id: "river", en: "river", zh: "河", field: "nature", concepticonId: "666" },
  { id: "sea", en: "sea", zh: "海", field: "nature", concepticonId: "1474" },
  { id: "wind", en: "wind", zh: "风", field: "nature", concepticonId: "960" },
  { id: "night", en: "night", zh: "夜晚", field: "nature", lists: [S, L], concepticonId: "1233" },

  // ── 物质 ─────────────────────────────────────────────────────────
  { id: "salt", en: "salt", zh: "盐", field: "substance", concepticonId: "1274" },
  { id: "milk", en: "milk", zh: "奶", field: "substance", concepticonId: "635" },
  { id: "honey", en: "honey", zh: "蜂蜜", field: "substance", concepticonId: "1602" },

  // ── 动作 ─────────────────────────────────────────────────────────
  { id: "drink", en: "drink", zh: "喝", field: "action", lists: [S, L], concepticonId: "1401" },
  { id: "eat", en: "eat", zh: "吃", field: "action", lists: [S, L], concepticonId: "1336" },
  { id: "bite", en: "bite", zh: "咬", field: "action", lists: [S], concepticonId: "1403" },
  { id: "see", en: "see", zh: "看见", field: "perception", lists: [S, L], concepticonId: "1409" },
  { id: "hear", en: "hear", zh: "听见", field: "perception", lists: [S, L], concepticonId: "1408" },
  { id: "know", en: "know", zh: "知道", field: "cognition", lists: [S, L], concepticonId: "1410" },
  { id: "think", en: "think", zh: "想", field: "cognition", lists: [L], concepticonId: "1415" },
  { id: "sleep", en: "sleep", zh: "睡", field: "action", lists: [S, L], concepticonId: "1585" },
  { id: "die", en: "die", zh: "死", field: "action", lists: [S, L], concepticonId: "1494" },
  { id: "kill", en: "kill", zh: "杀", field: "action", lists: [S, L], concepticonId: "1417" },
  { id: "become", en: "become", zh: "变成", field: "action", lists: [L], concepticonId: "1990" },
  { id: "break", en: "break", zh: "打破", field: "action", lists: [L], concepticonId: "2558" },
  { id: "cut", en: "cut", zh: "切", field: "action", lists: [L], concepticonId: "1432" },
  { id: "dig", en: "dig", zh: "挖", field: "action", lists: [L], concepticonId: "1418" },
  { id: "tie", en: "tie", zh: "系", field: "action", lists: [L], concepticonId: "1917" },
  { id: "wash", en: "wash", zh: "洗", field: "action", lists: [L], concepticonId: "1453" },
  { id: "cry", en: "cry", zh: "哭", field: "action", lists: [L], concepticonId: "1839" },
  { id: "hold", en: "hold", zh: "握", field: "action", lists: [L], concepticonId: "1448" },
  { id: "swim", en: "swim", zh: "游泳", field: "motion", lists: [S, L], concepticonId: "1439" },
  { id: "fly", en: "fly", zh: "飞", field: "motion", lists: [S, L], concepticonId: "1441" },
  { id: "walk", en: "walk", zh: "走", field: "motion", lists: [S, L], concepticonId: "1443" },
  { id: "go", en: "go", zh: "去", field: "motion", lists: [L], concepticonId: "695" },
  { id: "jump", en: "jump", zh: "跳", field: "motion", lists: [L], concepticonId: "1829" },
  { id: "come", en: "come", zh: "来", field: "motion", lists: [S, L], concepticonId: "1446" },
  { id: "sit", en: "sit", zh: "坐", field: "motion", lists: [S, L], concepticonId: "1416" },
  { id: "stand", en: "stand", zh: "站", field: "motion", lists: [S, L], concepticonId: "1442" },
  { id: "lie", en: "lie (recline)", zh: "躺", field: "motion", lists: [S], concepticonId: "215" },
  { id: "fall", en: "fall", zh: "落", field: "motion", lists: [L], concepticonId: "1280" },
  { id: "flow", en: "flow", zh: "流", field: "motion", lists: [L], concepticonId: "2005" },
  { id: "give", en: "give", zh: "给", field: "action", lists: [S, L], concepticonId: "1447" },
  { id: "say", en: "say", zh: "说", field: "action", lists: [S, L], concepticonId: "1458" },
  { id: "burn", en: "burn", zh: "烧", field: "action", lists: [S, L], concepticonId: "1428" },
  { id: "breathe", en: "breathe", zh: "呼吸", field: "action", lists: [L], concepticonId: "1407" },
  { id: "laugh", en: "laugh", zh: "笑", field: "action", lists: [L], concepticonId: "1355" },
  { id: "sing", en: "sing", zh: "唱", field: "action", lists: [L], concepticonId: "1261" },
  { id: "sew", en: "sew", zh: "缝", field: "action", lists: [L], concepticonId: "1793" },
  { id: "spit", en: "spit", zh: "吐", field: "action", lists: [L], concepticonId: "1440" },
  { id: "live", en: "live", zh: "活", field: "action", lists: [L], concepticonId: "1422" },
  { id: "make", en: "do / make", zh: "做", field: "action", lists: [L], concepticonId: "734" },
  { id: "name", en: "name", zh: "名字", field: "cognition", lists: [S, L], concepticonId: "1405" },

  // ── 性质 ─────────────────────────────────────────────────────────
  { id: "big", en: "big", zh: "大", field: "property", lists: [S, L], concepticonId: "1202" },
  { id: "long", en: "long", zh: "长", field: "property", lists: [S], concepticonId: "1203" },
  { id: "small", en: "small", zh: "小", field: "property", lists: [S, L], concepticonId: "1246" },
  { id: "red", en: "red", zh: "红", field: "property", lists: [S, L], concepticonId: "156" },
  { id: "green", en: "green", zh: "绿", field: "property", lists: [S], concepticonId: "1425" },
  { id: "yellow", en: "yellow", zh: "黄", field: "property", lists: [S], concepticonId: "1424" },
  { id: "white", en: "white", zh: "白", field: "property", lists: [S, L], concepticonId: "1335" },
  { id: "black", en: "black", zh: "黑", field: "property", lists: [S, L], concepticonId: "163" },
  { id: "hot", en: "hot", zh: "热", field: "property", lists: [S, L], concepticonId: "1286" },
  { id: "cold", en: "cold", zh: "冷", field: "property", lists: [S, L], concepticonId: "1287" },
  { id: "full", en: "full", zh: "满", field: "property", lists: [S], concepticonId: "1429" },
  { id: "new", en: "new", zh: "新", field: "property", lists: [S, L], concepticonId: "1231" },
  { id: "good", en: "good", zh: "好", field: "property", lists: [S], concepticonId: "1035" },
  { id: "round", en: "round", zh: "圆", field: "property", lists: [S], concepticonId: "1395" },
  { id: "dry", en: "dry", zh: "干", field: "property", lists: [S], concepticonId: "1398" },
  { id: "far", en: "far", zh: "远", field: "property", lists: [L], concepticonId: "1406" },
  { id: "bitter", en: "bitter", zh: "苦", field: "property", lists: [L], concepticonId: "1139" },

  // ── 文化与器物 ───────────────────────────────────────────────────
  { id: "house", en: "house", zh: "房子", field: "place", lists: [L], concepticonId: "1252" },
  { id: "path", en: "path", zh: "路", field: "place", lists: [S], concepticonId: "2252" },
  { id: "village", en: "village", zh: "村庄", field: "place", concepticonId: "930" },
  { id: "field", en: "field", zh: "田地", field: "place", concepticonId: "212" },
  { id: "rope", en: "rope", zh: "绳", field: "culture", concepticonId: "1218" },
  { id: "knife", en: "knife", zh: "刀", field: "culture", concepticonId: "1352" },
  { id: "bow", en: "bow", zh: "弓", field: "culture", concepticonId: "1278" },
  { id: "arrow", en: "arrow", zh: "箭", field: "culture", concepticonId: "977" },
  { id: "cloth", en: "cloth", zh: "布", field: "culture", concepticonId: "1892" },
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
  ...(seed.concepticonId ? { concepticon_id: seed.concepticonId } : {}),
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
  matchedOn: "id" | "zh" | "en" | "alias" | "field";
  isCustom: boolean;
}

/**
 * 概念检索：支持 `concept_id`、中文释义、英文释义、别名（`aliases`，
 * Roadmap v3 / Pillar 4）与语义域名称/标签。
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
    const aliases = (concept.aliases ?? []).map((alias) => alias.toLowerCase());

    let matchedOn: ConceptSearchHit["matchedOn"] | null = null;
    if (id === normalized) matchedOn = "id";
    else if (zh === normalized) matchedOn = "zh";
    else if (en === normalized) matchedOn = "en";
    else if (fld === normalized) matchedOn = "field";
    else if (aliases.includes(normalized)) matchedOn = "alias";
    else if (id.includes(normalized)) matchedOn = "id";
    else if (zh.includes(normalized)) matchedOn = "zh";
    else if (en.includes(normalized)) matchedOn = "en";
    else if (aliases.some((alias) => alias.includes(normalized))) matchedOn = "alias";

    if (matchedOn) hits.push({ ...item, matchedOn });
  }

  const rank: Record<ConceptSearchHit["matchedOn"], number> = {
    id: 0,
    zh: 1,
    en: 2,
    alias: 3,
    field: 4,
  };
  hits.sort((a, b) => {
    const diff = rank[a.matchedOn] - rank[b.matchedOn];
    if (diff !== 0) return diff;
    return a.concept.concept_id.localeCompare(b.concept.concept_id);
  });
  return hits.slice(0, limit);
}
