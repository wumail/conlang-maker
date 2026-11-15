/**
 * etymologyLineage.ts — 可点击词源追溯链（Roadmap v3 / Pillar 1）
 *
 * 纯函数 `buildEtymologyLineage` 从当前词向上递归展开完整词源链路：
 * - 继承步（evolved）：沿语系各语言词典追溯到共同语词根；
 * - 构词步（derived / compound）：解析本语言词典中的有序构词成分；
 * - 借入步（borrowed）：读取借入快照，供语词条存在时关联实时状态，
 *   供语已删则完整保留历史快照（不视为断链）。
 * 内置 visited 防环，遇到断链产出 broken 节点并精确定位缺失 ID。
 */
import type {
  BorrowedSourceSnapshot,
  CompoundRelation,
  LanguageEntry,
  MorphemeComponent,
  OriginType,
  SemanticChangeKind,
  WordEntry,
} from "../../types";

export interface EtymologyComponentResolved {
  relation: CompoundRelation;
  entryId?: string;
  derivationRuleId?: string;
  surface: string;
  gloss?: string;
  broken: boolean;
}

export interface EtymologyChainNode {
  stepKind: "self" | "inherited" | "borrowed" | "component";
  languageId: string;
  languageName: string;
  entryId: string;
  romanized: string;
  ipa: string;
  gloss: string;
  originType?: OriginType;
  appliedSoundChanges?: string[];
  semanticChangeKind?: SemanticChangeKind;
  semanticShiftNote?: string;
  borrowedSnapshot?: BorrowedSourceSnapshot;
  components?: EtymologyComponentResolved[];
  broken: boolean;
  brokenReason?: string;
}

export interface EtymologyLineageBrokenLink {
  kind: "parent" | "component" | "borrowed";
  missingId: string;
  languageId?: string;
}

export interface EtymologyLineageResult {
  nodes: EtymologyChainNode[];
  hasBrokenLinks: boolean;
  brokenLinks: EtymologyLineageBrokenLink[];
}

interface LineageContext {
  activeLanguageId: string;
  languages: LanguageEntry[];
  wordsByLanguage: Record<string, Record<string, WordEntry>>;
  nodes: EtymologyChainNode[];
  brokenLinks: EtymologyLineageBrokenLink[];
  visited: Set<string>;
}

function languageNameOf(
  context: LineageContext,
  languageId: string,
  fallback?: string,
): string {
  return (
    context.languages.find((lang) => lang.language_id === languageId)?.name ??
    fallback ??
    languageId
  );
}

function firstGloss(word: WordEntry): string {
  return word.senses.find((sense) => sense.gloss.trim().length > 0)?.gloss ?? "";
}

function dictOf(
  context: LineageContext,
  languageId: string,
): Record<string, WordEntry> | undefined {
  return context.wordsByLanguage[languageId];
}

function parentLanguageIdOf(
  context: LineageContext,
  languageId: string,
): string | null {
  return (
    context.languages.find((lang) => lang.language_id === languageId)?.parent_id ??
    null
  );
}

/** 解析一个节点的共时构词成分（芯片数据），缺失 entry_id 记入 brokenLinks */
function resolveComponents(
  context: LineageContext,
  word: WordEntry,
): EtymologyComponentResolved[] {
  const components: MorphemeComponent[] = word.etymology.components ?? [];
  if (components.length === 0) return [];
  const dict = dictOf(context, word.language_id) ?? {};
  return components.map((component): EtymologyComponentResolved => {
    if (component.entry_id) {
      const found = dict[component.entry_id];
      if (found) {
        return {
          relation: component.relation,
          entryId: component.entry_id,
          surface: found.con_word_romanized,
          gloss: firstGloss(found),
          broken: false,
        };
      }
      context.brokenLinks.push({
        kind: "component",
        missingId: component.entry_id,
        languageId: word.language_id,
      });
      return {
        relation: component.relation,
        entryId: component.entry_id,
        surface: component.surface_override ?? `?${component.entry_id}`,
        broken: true,
      };
    }
    return {
      relation: component.relation,
      derivationRuleId: component.derivation_rule_id,
      surface: component.surface_override ?? "",
      broken: false,
    };
  });
}

function baseNode(
  context: LineageContext,
  word: WordEntry,
  stepKind: EtymologyChainNode["stepKind"],
): EtymologyChainNode {
  return {
    stepKind,
    languageId: word.language_id,
    languageName: languageNameOf(context, word.language_id),
    entryId: word.entry_id,
    romanized: word.con_word_romanized,
    ipa: word.phonetic_ipa,
    gloss: firstGloss(word),
    originType: word.etymology.origin_type,
    appliedSoundChanges: word.etymology.applied_sound_changes,
    semanticChangeKind: word.etymology.semantic_change_kind,
    semanticShiftNote: word.etymology.semantic_shift_note,
    broken: false,
  };
}

/** 为成分词条追加可点击链路节点（成分本身还可能再含成分/继承链） */
function appendComponentNodes(
  context: LineageContext,
  word: WordEntry,
): void {
  const components: MorphemeComponent[] = word.etymology.components ?? [];
  if (components.length === 0) return;
  const dict = dictOf(context, word.language_id) ?? {};
  for (const component of components) {
    if (!component.entry_id) continue;
    const key = `${word.language_id}:${component.entry_id}`;
    const found = dict[component.entry_id];
    if (!found) continue; // broken 已在 resolveComponents 中记录
    if (context.visited.has(key)) continue; // 防环：成分环路
    context.visited.add(key);
    const node = baseNode(context, found, "component");
    node.components = resolveComponents(context, found);
    context.nodes.push(node);
    appendComponentNodes(context, found);
  }
}

function appendInheritedChain(
  context: LineageContext,
  word: WordEntry,
): void {
  const etymology = word.etymology;

  if (etymology.origin_type === "evolved") {
    const sourceLanguageId =
      etymology.source_language_id ?? parentLanguageIdOf(context, word.language_id);
    const parentEntryId = etymology.parent_entry_id;

    if (!parentEntryId) {
      context.brokenLinks.push({
        kind: "parent",
        missingId: "",
        ...(sourceLanguageId ? { languageId: sourceLanguageId } : {}),
      });
      context.nodes.push({
        stepKind: "inherited",
        languageId: sourceLanguageId ?? "",
        languageName: sourceLanguageId
          ? languageNameOf(context, sourceLanguageId)
          : "",
        entryId: "",
        romanized: "",
        ipa: "",
        gloss: "",
        broken: true,
        brokenReason: "missing_parent_entry_id",
      });
      return;
    }

    const parentDict = sourceLanguageId ? dictOf(context, sourceLanguageId) : undefined;
    const parentWord = parentDict?.[parentEntryId];
    if (!parentWord) {
      context.brokenLinks.push({
        kind: "parent",
        missingId: parentEntryId,
        ...(sourceLanguageId ? { languageId: sourceLanguageId } : {}),
      });
      context.nodes.push({
        stepKind: "inherited",
        languageId: sourceLanguageId ?? "",
        languageName: sourceLanguageId
          ? languageNameOf(context, sourceLanguageId)
          : "",
        entryId: parentEntryId,
        romanized: `?${parentEntryId}`,
        ipa: "",
        gloss: "",
        broken: true,
        brokenReason: "missing_parent_entry",
      });
      return;
    }

    const key = `${sourceLanguageId}:${parentEntryId}`;
    if (context.visited.has(key)) return; // 防环：继承环路
    context.visited.add(key);

    const node = baseNode(context, parentWord, "inherited");
    node.components = resolveComponents(context, parentWord);
    context.nodes.push(node);
    appendComponentNodes(context, parentWord);
    appendInheritedChain(context, parentWord);
    return;
  }

  if (etymology.origin_type === "borrowed") {
    appendBorrowedChain(context, word);
  }
  // derived / compound / a_priori / a_posteriori / mixed：本语言共时构词创新，链路止于成分节点
}

function appendBorrowedChain(
  context: LineageContext,
  word: WordEntry,
): void {
  const etymology = word.etymology;
  const snapshot = etymology.borrowed_source;

  if (!snapshot) {
    // 无快照：尝试旧版引用（parent_entry_id 曾被误用于供语词条）
    const legacyDonorLanguageId = etymology.source_language_id;
    const legacyDonorEntryId = etymology.parent_entry_id;
    const legacyDonor = legacyDonorLanguageId && legacyDonorEntryId
      ? dictOf(context, legacyDonorLanguageId)?.[legacyDonorEntryId]
      : undefined;
    if (legacyDonor) {
      appendLiveDonorChain(context, legacyDonor);
      return;
    }
    context.brokenLinks.push({
      kind: "borrowed",
      missingId: legacyDonorEntryId ?? "",
      ...(legacyDonorLanguageId ? { languageId: legacyDonorLanguageId } : {}),
    });
    context.nodes.push({
      stepKind: "borrowed",
      languageId: legacyDonorLanguageId ?? "",
      languageName: legacyDonorLanguageId
        ? languageNameOf(context, legacyDonorLanguageId)
        : "",
      entryId: legacyDonorEntryId ?? "",
      romanized: "",
      ipa: "",
      gloss: "",
      broken: true,
      brokenReason: "missing_borrowed_source",
    });
    return;
  }

  const donorDict = dictOf(context, snapshot.source_language_id);
  const donorWord = donorDict?.[snapshot.source_entry_id];

  if (!donorWord) {
    // 供语词条已删（或属于跨项目）：完整保留历史快照，不算断链
    context.nodes.push({
      stepKind: "borrowed",
      languageId: snapshot.source_language_id,
      languageName:
        snapshot.source_language_name ??
        languageNameOf(context, snapshot.source_language_id),
      entryId: snapshot.source_entry_id,
      romanized: snapshot.borrowed_form,
      ipa: snapshot.borrowed_ipa ?? "",
      gloss: snapshot.borrowed_gloss ?? "",
      borrowedSnapshot: snapshot,
      broken: false,
      brokenReason: "donor_removed_snapshot_kept",
    });
    return;
  }

  // 供语词条存在：展示实时状态并保留快照，链路继续向上追溯
  const key = `${snapshot.source_language_id}:${snapshot.source_entry_id}`;
  const alreadyVisited = context.visited.has(key);
  if (!alreadyVisited) context.visited.add(key);
  const node = baseNode(context, donorWord, "borrowed");
  node.borrowedSnapshot = snapshot;
  node.components = resolveComponents(context, donorWord);
  context.nodes.push(node);
  if (alreadyVisited) return; // 防环：借词环路
  appendComponentNodes(context, donorWord);
  appendInheritedChain(context, donorWord);
}

function appendLiveDonorChain(
  context: LineageContext,
  donorWord: WordEntry,
): void {
  const key = `${donorWord.language_id}:${donorWord.entry_id}`;
  if (context.visited.has(key)) return;
  context.visited.add(key);
  const node = baseNode(context, donorWord, "borrowed");
  node.components = resolveComponents(context, donorWord);
  context.nodes.push(node);
  appendComponentNodes(context, donorWord);
  appendInheritedChain(context, donorWord);
}

export function buildEtymologyLineage(params: {
  word: WordEntry;
  activeLanguageId: string;
  languages: LanguageEntry[];
  wordsByLanguage: Record<string, Record<string, WordEntry>>;
}): EtymologyLineageResult {
  const context: LineageContext = {
    activeLanguageId: params.activeLanguageId,
    languages: params.languages,
    wordsByLanguage: params.wordsByLanguage,
    nodes: [],
    brokenLinks: [],
    visited: new Set<string>(),
  };

  const word = params.word.language_id
    ? params.word
    : { ...params.word, language_id: params.activeLanguageId };

  context.visited.add(`${word.language_id}:${word.entry_id}`);
  const selfNode = baseNode(context, word, "self");
  selfNode.components = resolveComponents(context, word);
  context.nodes.push(selfNode);

  appendComponentNodes(context, word);
  appendInheritedChain(context, word);

  return {
    nodes: context.nodes,
    hasBrokenLinks: context.brokenLinks.length > 0,
    brokenLinks: context.brokenLinks,
  };
}
