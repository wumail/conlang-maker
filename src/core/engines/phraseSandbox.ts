/**
 * phraseSandbox.ts — 递归短语树与格对齐句法台（T3.3 / F4.3）
 *
 * 四阶段线性化：
 *   1. 论元格对齐分配（nom_acc / erg_abs / tripartite）
 *   2. 中心语标记类型（head_marking）决定格标记落在名词、动词还是双标
 *   3. 核心与依附成分的一致关系传播（数 / 格的形容词协变）
 *   4. 递归语序展开（NP 修饰语 + PP 嵌套）并交给上层渲染形态音位
 *
 * 与旧 `sandbox.reorderBySyntax` 的关键差别：每个 NPNode 独立持有自己的
 * 限定词、数词、形容词与属格领属者，不再把所有 Mod 串绑到宾语上。
 */
import type {
  GrammarConfig,
  HeadMarking,
  InflectionDimension,
  MorphosyntacticAlignment,
} from "../../types";

export type Alignment = MorphosyntacticAlignment;
export type CaseRole = "nom" | "acc" | "erg" | "abs" | "gen";
export type ArgumentRole = "S" | "A" | "P";

export type ClausePolarity = "affirmative" | "negative";

export interface NPNode {
  /** 词条释义（查找键） */
  head: string;
  /** 数范畴的维度值 gloss（如 SG / PL），由语法维度解析后注入中心语标签链 */
  number?: string;
  determiner?: string;
  numeral?: string;
  adjectives?: string[];
  /** 递归领属者：the dog's bone */
  possessor?: NPNode;
  /** 递归介词短语：the dog in the house */
  pp?: PPNode;
}

export interface PPNode {
  /** 介词/后置词的释义 */
  adposition: string;
  object: NPNode;
}

export interface VerbNode {
  gloss: string;
  /** 时/体/态等屈折标签，按顺序附加 */
  tam?: string[];
}

export interface ClauseNode {
  subject: NPNode;
  verb: VerbNode;
  object?: NPNode;
  obliques?: PPNode[];
  /** 极性；缺省视为 affirmative */
  polarity?: ClausePolarity;
}

export type PhraseRole =
  | "S"
  | "A"
  | "P"
  | "V"
  | "ADP"
  | "DET"
  | "NUM"
  | "ADJ"
  | "POSS"
  | "NEG";

export interface PhraseWord {
  gloss: string;
  role: PhraseRole;
  /** 该词所属论元（S/A/P）或 null（动词、介词） */
  argument: ArgumentRole | null;
  caseTag: string | null;
  tags: string[];
  /** 结构路径，如 "P.possessor" / "OBL0.object" */
  path: string;
}

export interface PhrasePlan {
  alignment: Alignment;
  /** 中心语标记类型；决定格标记落点 */
  headMarking: HeadMarking;
  caseTags: Record<ArgumentRole, string | null>;
  /** 最终线性顺序 */
  words: PhraseWord[];
  /** Leipzig 逐词标注行 */
  glossLine: string;
  steps: string[];
  warnings: string[];
}

export interface ResolvedCase {
  dimId: string;
  valId: string;
  gloss: string;
}

const CASE_GLOSS_ALIASES: Record<CaseRole, readonly string[]> = {
  nom: ["NOM", "SBJ"],
  acc: ["ACC", "OBJ"],
  erg: ["ERG"],
  abs: ["ABS"],
  gen: ["GEN", "POSS"],
};

/** 在语法配置里找到某个格角色的维度值（显式绑定优先，其次按 gloss 匹配） */
export function resolveCaseDimensionValue(
  grammar: GrammarConfig,
  role: CaseRole,
): ResolvedCase | null {
  const binding = grammar.syntax.case_gloss_map?.[role];
  if (binding) {
    const dim = grammar.inflection_dimensions.find(
      (item) => item.dim_id === binding.dim_id,
    );
    const value = dim?.values.find((item) => item.val_id === binding.val_id);
    if (dim && value) {
      return { dimId: dim.dim_id, valId: value.val_id, gloss: value.gloss || value.name };
    }
  }

  const aliases = CASE_GLOSS_ALIASES[role];
  for (const dim of grammar.inflection_dimensions) {
    if (!isCaseDimension(dim)) continue;
    for (const value of dim.values) {
      const gloss = (value.gloss || value.name).trim().toUpperCase();
      if (aliases.includes(gloss)) {
        return { dimId: dim.dim_id, valId: value.val_id, gloss: value.gloss || value.name };
      }
    }
  }
  return null;
}

/** 维度的值中至少有一个像格标记，才视为格维度 */
function isCaseDimension(dim: InflectionDimension): boolean {
  const prefixes = ["NOM", "ACC", "ERG", "ABS", "GEN", "DAT", "LOC", "INS", "OBL"];
  return dim.values.some((value) =>
    prefixes.includes((value.gloss || "").trim().toUpperCase()),
  );
}

const NUMBER_GLOSS_HINTS = ["SG", "PL", "DU", "SING", "PLUR", "DUAL"];

/** 维度名或维度值暗示「数」范畴 */
function isNumberDimension(dim: InflectionDimension): boolean {
  if (dim.name.toLowerCase().includes("number") || dim.name.includes("数")) {
    return true;
  }
  return dim.values.some((value) =>
    NUMBER_GLOSS_HINTS.includes((value.gloss || "").trim().toUpperCase()),
  );
}

/**
 * 把 NPNode.number 解析为语法中的数维度值。
 * 未在语法中登记时按原样注入 gloss，便于作者先写句后补范式。
 */
export function resolveNumberDimensionValue(
  grammar: GrammarConfig,
  number: string | undefined,
): { dimId: string; gloss: string } | null {
  const wanted = number?.trim();
  if (!wanted) return null;
  const upper = wanted.toUpperCase();
  for (const dim of grammar.inflection_dimensions) {
    if (!isNumberDimension(dim)) continue;
    const value = dim.values.find(
      (item) =>
        (item.gloss || item.name).trim().toUpperCase() === upper ||
        item.val_id.trim().toUpperCase() === upper ||
        item.name.trim().toUpperCase() === upper,
    );
    if (value) return { dimId: dim.dim_id, gloss: (value.gloss || value.name).trim() };
  }
  return { dimId: "", gloss: wanted };
}

/** 形容词词性的 pos_id（形容词协变的前置条件） */
function findAdjectivePosId(grammar: GrammarConfig): string | null {
  const pos = grammar.parts_of_speech.find((item) => {
    const abbr = item.gloss_abbr.trim().toLowerCase();
    const name = item.name.toLowerCase();
    return abbr === "adj" || name.includes("adjective") || item.name.includes("形容词");
  });
  return pos?.pos_id ?? null;
}

/** 维度是否作用于给定词性（用于格 / 数的形容词协变） */
function dimensionAppliesTo(
  grammar: GrammarConfig,
  dimId: string | null,
  posId: string | null,
): boolean {
  if (!dimId || !posId) return false;
  const dim = grammar.inflection_dimensions.find((item) => item.dim_id === dimId);
  return dim ? dim.applies_to_pos.includes(posId) : false;
}

/** 按对齐类型把 S/A/P 映射到具体格角色 */
export function assignCaseRoles(
  alignment: Alignment,
  argument: ArgumentRole,
): CaseRole {
  if (alignment === "erg_abs") {
    return argument === "A" ? "erg" : "abs";
  }
  if (alignment === "tripartite") {
    if (argument === "S") return "nom";
    return argument === "A" ? "erg" : "acc";
  }
  return argument === "P" ? "acc" : "nom";
}

interface NegativeMarker {
  kind: "affix" | "particle";
  tag: string;
}

/**
 * 查找否定标记：优先动词词缀规则（tag = NEG），其次极性维度的 NEG 值，
 * 都没有时退化为独立否定小词。
 */
export function resolveNegativeMarker(grammar: GrammarConfig): NegativeMarker {
  const rule = grammar.inflection_rules.find(
    (item) => !item.disabled && item.tag.trim().toUpperCase() === "NEG",
  );
  if (rule) return { kind: "affix", tag: rule.tag.trim().toUpperCase() };

  for (const dim of grammar.inflection_dimensions) {
    const name = dim.name.toLowerCase();
    if (!name.includes("polarity") && !name.includes("negat") && !dim.name.includes("极性")) {
      continue;
    }
    const value = dim.values.find(
      (item) => (item.gloss || item.name).trim().toUpperCase() === "NEG",
    );
    if (value) {
      return { kind: "affix", tag: (value.gloss || value.name).trim().toUpperCase() };
    }
  }
  return { kind: "particle", tag: "NEG" };
}

interface LinearizeContext {
  beforeHead: boolean;
  preposition: boolean;
  caseTags: Record<ArgumentRole, string | null>;
  /** 属格标记（用于递归领属者） */
  genTag: string | null;
  genDimId: string | null;
  headMarking: HeadMarking;
  grammar: GrammarConfig;
  adjPosId: string | null;
}

function linearizeNP(
  np: NPNode,
  context: LinearizeContext,
  path: string,
  argument: ArgumentRole | null,
  caseTag: string | null,
  caseDimId: string | null,
  isPossessor = false,
): PhraseWord[] {
  const { grammar, adjPosId } = context;
  const number = resolveNumberDimensionValue(grammar, np.number);
  // 中心语标记只搬移论元格；属格是名词内部的依附标记，head 模式下仍留在领属者上
  const marksCaseOnHead =
    context.headMarking === "dependent" ||
    context.headMarking === "double" ||
    (isPossessor && context.headMarking === "head");

  // 形容词协变：语法里同维度也作用于形容词词性时，格 / 数同步落到修饰语上
  const modifierTags: string[] = [];
  if (number && dimensionAppliesTo(grammar, number.dimId, adjPosId)) {
    modifierTags.push(number.gloss);
  }
  if (marksCaseOnHead && caseTag && dimensionAppliesTo(grammar, caseDimId, adjPosId)) {
    modifierTags.push(caseTag);
  }

  const modifiers: PhraseWord[] = [];
  if (np.determiner) {
    modifiers.push({
      gloss: np.determiner,
      role: "DET",
      argument,
      caseTag: null,
      tags: [],
      path: `${path}.det`,
    });
  }
  if (np.numeral) {
    modifiers.push({
      gloss: np.numeral,
      role: "NUM",
      argument,
      caseTag: null,
      tags: [],
      path: `${path}.num`,
    });
  }
  (np.adjectives ?? []).forEach((adjective, index) => {
    modifiers.push({
      gloss: adjective,
      role: "ADJ",
      argument,
      caseTag: null,
      tags: [...modifierTags],
      path: `${path}.adj[${index}]`,
    });
  });

  const possessorWords = np.possessor
    ? linearizeNP(
        np.possessor,
        context,
        `${path}.possessor`,
        argument,
        context.genTag,
        context.genDimId,
        true,
      )
    : [];

  const headTags: string[] = [];
  if (marksCaseOnHead && caseTag) headTags.push(caseTag);
  if (number) headTags.push(number.gloss);

  const head: PhraseWord = {
    gloss: np.head,
    role: isPossessor ? "POSS" : (argument ?? "P"),
    argument,
    caseTag: marksCaseOnHead ? caseTag : null,
    tags: headTags,
    path,
  };

  const ppWords = np.pp ? linearizePP(np.pp, context, `${path}.pp`) : [];

  return context.beforeHead
    ? [...possessorWords, ...modifiers, head, ...ppWords]
    : [head, ...ppWords, ...modifiers.slice().reverse(), ...possessorWords];
}

function linearizePP(
  pp: PPNode,
  context: LinearizeContext,
  path: string,
): PhraseWord[] {
  const adposition: PhraseWord = {
    gloss: pp.adposition,
    role: "ADP",
    argument: null,
    caseTag: null,
    tags: [],
    path: `${path}.adp`,
  };
  const objectWords = linearizeNP(
    pp.object,
    context,
    `${path}.object`,
    null,
    null,
    null,
  );
  return context.preposition
    ? [adposition, ...objectWords]
    : [...objectWords, adposition];
}

/** 生成句法计划（纯函数，不修改输入） */
export function linearizeClause(
  clause: ClauseNode,
  grammar: GrammarConfig,
): PhrasePlan {
  const alignment = grammar.syntax.alignment ?? "nom_acc";
  const headMarking: HeadMarking = grammar.typology?.head_marking ?? "dependent";
  const transitive = clause.object !== undefined;
  const warnings: string[] = [];
  const steps: string[] = [];

  const roles: ArgumentRole[] = transitive ? ["S", "A", "P"] : ["S"];
  const caseTags: Record<ArgumentRole, string | null> = { S: null, A: null, P: null };
  const caseDims: Record<ArgumentRole, string | null> = { S: null, A: null, P: null };

  if (headMarking === "none") {
    steps.push(
      "Head marking none: case affixes suppressed, word order and adpositions carry the roles",
    );
  } else {
    for (const role of roles) {
      const caseRole = assignCaseRoles(alignment, role);
      const resolved = resolveCaseDimensionValue(grammar, caseRole);
      caseTags[role] = resolved?.gloss ?? null;
      caseDims[role] = resolved?.dimId ?? null;
      if (resolved) {
        steps.push(
          `${role} → ${caseRole.toUpperCase()} (${resolved.dimId}/${resolved.valId} = ${resolved.gloss})`,
        );
      }
    }
    const missing = roles.filter((role) => caseTags[role] === null);
    if (missing.length > 0) {
      warnings.push(
        `No case dimension value found for ${missing.join(", ")}; those arguments stay unmarked.`,
      );
    }
  }

  const gen = resolveCaseDimensionValue(grammar, "gen");
  const context: LinearizeContext = {
    beforeHead: grammar.syntax.modifier_position === "before_head",
    preposition: grammar.syntax.adposition_type === "preposition",
    caseTags,
    genTag: gen?.gloss ?? null,
    genDimId: gen?.dimId ?? null,
    headMarking,
    grammar,
    adjPosId: findAdjectivePosId(grammar),
  };

  const subjectRole: ArgumentRole = transitive ? "A" : "S";
  const subjectWords = linearizeNP(
    clause.subject,
    context,
    "subject",
    subjectRole,
    caseTags[subjectRole],
    caseDims[subjectRole],
  );

  const objectWords = clause.object
    ? linearizeNP(clause.object, context, "object", "P", caseTags.P, caseDims.P)
    : [];

  const verbTags: string[] = [...(clause.verb.tam ?? [])];

  // 中心语标记：论元格标记汇入动词标签链（head / double）
  if (headMarking === "head" || headMarking === "double") {
    const indexedRoles: ArgumentRole[] = transitive ? ["A", "P"] : ["S"];
    for (const role of indexedRoles) {
      const tag = caseTags[role];
      if (!tag) continue;
      verbTags.push(`${role}:${tag}`);
      steps.push(`Head marking: verb indexes ${role} → ${role}:${tag}`);
    }
    if (headMarking === "double") {
      steps.push("Head marking double: case appears on both NPs and the verb");
    }
  }

  // 极性：否定句自动挂接 NEG 词缀，或退化为独立否定小词
  let negator: PhraseWord | null = null;
  if (clause.polarity === "negative") {
    const marker = resolveNegativeMarker(grammar);
    if (marker.kind === "affix") {
      verbTags.push(marker.tag);
      steps.push(`Negative polarity: verb suffix/affix ${marker.tag}`);
    } else {
      negator = {
        gloss: marker.tag,
        role: "NEG",
        argument: null,
        caseTag: null,
        tags: [],
        path: "neg",
      };
      steps.push(`Negative polarity: independent negator ${marker.tag} before the verb`);
    }
  }

  const verbWord: PhraseWord = {
    gloss: clause.verb.gloss,
    role: "V",
    argument: null,
    caseTag: null,
    tags: verbTags,
    path: "verb",
  };
  const verbWords: PhraseWord[] = negator ? [negator, verbWord] : [verbWord];

  const groups: Record<"S" | "V" | "O", PhraseWord[]> = {
    S: subjectWords,
    V: verbWords,
    O: objectWords,
  };
  const orderMap: Record<string, ("S" | "V" | "O")[]> = {
    SVO: ["S", "V", "O"],
    SOV: ["S", "O", "V"],
    VSO: ["V", "S", "O"],
    VOS: ["V", "O", "S"],
    OVS: ["O", "V", "S"],
    OSV: ["O", "S", "V"],
  };
  const order = orderMap[grammar.syntax.word_order] ?? ["S", "V", "O"];
  const words: PhraseWord[] = [];
  for (const slot of order) {
    if (slot === "O" && !clause.object) continue;
    words.push(...groups[slot]);
  }
  for (const [index, pp] of (clause.obliques ?? []).entries()) {
    words.push(...linearizePP(pp, context, `OBL${index}`));
  }
  steps.push(
    `Order ${grammar.syntax.word_order}: ${order.filter((slot) => slot !== "O" || clause.object).join(" ")}`,
  );
  steps.push(
    `Modifiers ${context.beforeHead ? "before" : "after"} head; adpositions ${context.preposition ? "pre" : "post"}posed`,
  );

  return {
    alignment,
    headMarking,
    caseTags,
    words,
    glossLine: words
      .map((word) =>
        word.tags.length > 0 ? `${word.gloss}-${word.tags.join("-")}` : word.gloss,
      )
      .join(" "),
    steps,
    warnings,
  };
}

export interface PhraseTreeNode {
  label: string;
  children: PhraseTreeNode[];
}

/** 把计划还原为嵌套树（供 UI 展示结构） */
export function planToTree(clause: ClauseNode, plan: PhrasePlan): PhraseTreeNode {
  const byPath = new Map(plan.words.map((word) => [word.path, word]));
  const label = (word: PhraseWord | undefined): string => {
    if (!word) return "";
    return word.tags.length > 0
      ? `${word.gloss}-${word.tags.join("-")}`
      : word.gloss;
  };
  const npChildren = (np: NPNode, path: string): PhraseTreeNode[] => {
    const children: PhraseTreeNode[] = [];
    const head = byPath.get(path);
    if (head) {
      children.push({ label: label(head), children: [] });
    }
    (np.adjectives ?? []).forEach((_adjective, index) => {
      const word = byPath.get(`${path}.adj[${index}]`);
      if (word) children.push({ label: label(word), children: [] });
    });
    if (np.determiner) {
      const word = byPath.get(`${path}.det`);
      if (word) children.push({ label: word.gloss, children: [] });
    }
    if (np.numeral) {
      const word = byPath.get(`${path}.num`);
      if (word) children.push({ label: word.gloss, children: [] });
    }
    if (np.possessor) {
      const possessor = byPath.get(`${path}.possessor`);
      children.push({
        label: `POSS ${label(possessor) || np.possessor.head}`,
        children: [],
      });
    }
    if (np.pp) {
      const adp = byPath.get(`${path}.pp.adp`);
      children.push({ label: `PP ${adp?.gloss ?? np.pp.adposition}`, children: [] });
    }
    return children;
  };

  const verbWord = byPath.get("verb");
  const negatorWord = byPath.get("neg");

  return {
    label: `Clause (${plan.alignment})`,
    children: [
      {
        label: `Subject: ${clause.subject.head}`,
        children: npChildren(clause.subject, "subject"),
      },
      ...(clause.object
        ? [
            {
              label: `Object: ${clause.object.head}`,
              children: npChildren(clause.object, "object"),
            },
          ]
        : []),
      ...(negatorWord ? [{ label: "Negator", children: [{ label: label(negatorWord), children: [] }] }] : []),
      {
        label: `Verb: ${clause.verb.gloss}`,
        children: (verbWord?.tags ?? clause.verb.tam ?? []).map((tag) => ({
          label: tag,
          children: [],
        })),
      },
    ],
  };
}
