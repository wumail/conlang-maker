/**
 * phraseSandbox.ts — 递归短语树与格对齐句法台（T3.3）
 *
 * 三阶段线性化：
 *   1. 论元格对齐分配（nom_acc / erg_abs / tripartite）
 *   2. 核心与依附成分的一致关系传播（格标记只落在 NP 中心语）
 *   3. 递归语序展开（NP 修饰语 + PP 嵌套）并交给上层渲染形态音位
 *
 * 与旧 `sandbox.reorderBySyntax` 的关键差别：每个 NPNode 独立持有自己的
 * 限定词、数词、形容词与属格领属者，不再把所有 Mod 串绑到宾语上。
 */
import type {
  GrammarConfig,
  InflectionDimension,
  MorphosyntacticAlignment,
} from "../../types";

export type Alignment = MorphosyntacticAlignment;
export type CaseRole = "nom" | "acc" | "erg" | "abs" | "gen";
export type ArgumentRole = "S" | "A" | "P";

export interface NPNode {
  /** 词条释义（查找键） */
  head: string;
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
  | "POSS";

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

interface LinearizeContext {
  beforeHead: boolean;
  preposition: boolean;
  caseTags: Record<ArgumentRole, string | null>;
  /** 属格标记（用于递归领属者） */
  genTag: string | null;
}

function linearizeNP(
  np: NPNode,
  context: LinearizeContext,
  path: string,
  argument: ArgumentRole | null,
  caseTag: string | null,
  isPossessor = false,
): PhraseWord[] {
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
      tags: [],
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
        true,
      )
    : [];

  const head: PhraseWord = {
    gloss: np.head,
    role: isPossessor ? "POSS" : (argument ?? "P"),
    argument,
    caseTag,
    tags: caseTag ? [caseTag] : [],
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
  const objectWords = linearizeNP(pp.object, context, `${path}.object`, null, null);
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
  const transitive = clause.object !== undefined;
  const warnings: string[] = [];
  const steps: string[] = [];

  const roles: ArgumentRole[] = transitive ? ["S", "A", "P"] : ["S"];
  const caseTags: Record<ArgumentRole, string | null> = { S: null, A: null, P: null };
  for (const role of roles) {
    const caseRole = assignCaseRoles(alignment, role);
    const resolved = resolveCaseDimensionValue(grammar, caseRole);
    caseTags[role] = resolved?.gloss ?? null;
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

  const context: LinearizeContext = {
    beforeHead: grammar.syntax.modifier_position === "before_head",
    preposition: grammar.syntax.adposition_type === "preposition",
    caseTags,
    genTag: resolveCaseDimensionValue(grammar, "gen")?.gloss ?? null,
  };

  const subjectRole: ArgumentRole = transitive ? "A" : "S";
  const subjectWords = linearizeNP(
    clause.subject,
    context,
    "subject",
    subjectRole,
    caseTags[subjectRole],
  );

  const objectWords = clause.object
    ? linearizeNP(clause.object, context, "object", "P", caseTags.P)
    : [];

  const verbWords: PhraseWord[] = [
    {
      gloss: clause.verb.gloss,
      role: "V",
      argument: null,
      caseTag: null,
      tags: clause.verb.tam ?? [],
      path: "verb",
    },
  ];

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
  const npChildren = (np: NPNode, path: string): PhraseTreeNode[] => {
    const children: PhraseTreeNode[] = [];
    const head = byPath.get(path);
    if (head) {
      children.push({
        label: `${head.gloss}${head.caseTag ? `-${head.caseTag}` : ""}`,
        children: [],
      });
    }
    (np.adjectives ?? []).forEach((_adjective, index) => {
      const word = byPath.get(`${path}.adj[${index}]`);
      if (word) children.push({ label: word.gloss, children: [] });
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
        label: `POSS ${possessor?.gloss ?? np.possessor.head}`,
        children: [],
      });
    }
    if (np.pp) {
      const adp = byPath.get(`${path}.pp.adp`);
      children.push({ label: `PP ${adp?.gloss ?? np.pp.adposition}`, children: [] });
    }
    return children;
  };

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
      {
        label: `Verb: ${clause.verb.gloss}`,
        children: (clause.verb.tam ?? []).map((tag) => ({ label: tag, children: [] })),
      },
    ],
  };
}
