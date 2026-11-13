/**
 * referenceBookBuilder.ts — 出版级参考语法与双向词典（T3.4）
 *
 * 纯字符串构建：输出单文件 HTML（内嵌 Base64 字体，可直接打印为矢量 PDF）
 * 与结构对应的 Typst 源码。所有用户输入一律转义。
 */
import type {
  ConceptDefinition,
  CorpusText,
  GrammarChapter,
  GrammarConfig,
  PhonologyConfig,
  WordEntry,
} from "../../types";
import { getCoreConcept } from "../../data/core_concepts";
import { generateParadigm } from "./morphologyEngine";
import {
  buildFontInputIndex,
  textToFontInput,
  type FontInputIndex,
} from "./fontInput";
import { fontFeaturesToCss } from "./fontLayout";

export interface ReferenceBookSections {
  phonology: boolean;
  typology: boolean;
  paradigms: boolean;
  manual: boolean;
  corpus: boolean;
  dictionary: boolean;
  reverseIndex: boolean;
}

export interface ReferenceBookOptions {
  languageName: string;
  nativeName?: string;
  author?: string;
  generatedAt?: string;
  phono: PhonologyConfig;
  grammar: GrammarConfig;
  words: WordEntry[];
  corpus?: CorpusText[];
  sections: ReferenceBookSections;
  /** 本族字体（Base64，不含 data URI 前缀） */
  fontBase64?: string | null;
  fontMime?: string;
  /** 字体文件名，用于 .otf 格式自适应 */
  fontFileName?: string;
  /** 工作区自定义概念（与内置概念合并后用于徽章与反向索引） */
  concepts?: readonly ConceptDefinition[];
}

export const DEFAULT_REFERENCE_SECTIONS: ReferenceBookSections = {
  phonology: true,
  typology: true,
  paradigms: true,
  manual: true,
  corpus: true,
  dictionary: true,
  reverseIndex: true,
};

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

const TYPST_ESCAPES: Record<string, string> = {
  "\\": "\\\\",
  "#": "\\#",
  "*": "\\*",
  _: "\\_",
  $: "\\$",
  "@": "\\@",
  "<": "\\<",
  ">": "\\>",
  "`": "\\`",
};

export function escapeTypst(value: string): string {
  return value.replace(/[\\#*_$@<>`]/g, (character) => TYPST_ESCAPES[character] ?? character);
}

/** 本族文字输入：词典词头（走共享索引，保留词条专属读音） */
export function wordToFontText(
  word: WordEntry,
  config: PhonologyConfig,
  index: FontInputIndex | null,
): string {
  if (!config.font_input) return "";
  return textToFontInput(
    word.con_word_romanized,
    config,
    index ?? undefined,
    word.entry_id,
  );
}

/** 本族文字输入：任意罗马字片段（语料行、范式单元格） */
export function textToFontText(
  text: string,
  config: PhonologyConfig,
  index: FontInputIndex | null,
): string {
  if (!config.font_input) return "";
  return textToFontInput(text, config, index ?? undefined);
}

interface RenderContext {
  fontIndex: FontInputIndex | null;
  fontFeatures: readonly string[];
  conceptOf: (conceptId?: string) => ConceptDefinition | undefined;
  wordsById: Map<string, WordEntry>;
}

function buildContext(options: ReferenceBookOptions, withFontIndex: boolean): RenderContext {
  const custom = new Map((options.concepts ?? []).map((concept) => [concept.concept_id, concept]));
  return {
    fontIndex:
      withFontIndex && options.phono.font_input
        ? buildFontInputIndex(options.words, options.grammar, options.phono)
        : null,
    fontFeatures: options.phono.font_features ?? [],
    conceptOf: (conceptId) =>
      conceptId ? getCoreConcept(conceptId) ?? custom.get(conceptId) : undefined,
    wordsById: new Map(options.words.map((word) => [word.entry_id, word])),
  };
}

function byRomanized(left: WordEntry, right: WordEntry): number {
  return left.con_word_romanized.localeCompare(right.con_word_romanized);
}

function senseGlosses(word: WordEntry): string[] {
  return word.senses.map((sense) => sense.gloss.trim()).filter((gloss) => gloss.length > 0);
}

function posName(grammar: GrammarConfig, posId: string): string {
  return grammar.parts_of_speech.find((pos) => pos.pos_id === posId)?.name ?? posId;
}

function dimensionName(grammar: GrammarConfig, dimId: string): string {
  return (
    grammar.inflection_dimensions.find((dimension) => dimension.dim_id === dimId)?.name ??
    dimId
  );
}

type TableCell = string | { html: string };

function renderCell(cell: TableCell): string {
  return typeof cell === "string" ? escapeHtml(cell) : cell.html;
}

function table(headers: string[], rows: TableCell[][], className = ""): string {
  const head = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${renderCell(cell)}</td>`).join("")}</tr>`)
    .join("\n");
  return `<table class="${className}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderPhonology(options: ReferenceBookOptions): string {
  const { phono } = options;
  const consonants = phono.phoneme_inventory.consonants;
  const vowels = phono.phoneme_inventory.vowels;
  const map = phono.romanization_maps.find((item) => item.is_default)
    ?? phono.romanization_maps[0];

  const romanizationRows =
    map?.rules.map((rule) => [
      rule.input,
      rule.output_type === "separator" ? "∅" : rule.output_phoneme,
      `${rule.context_before} _ ${rule.context_after}`.trim(),
    ]) ?? [];

  return `
<section id="phonology">
  <h1>1. Phonology</h1>
  <h2>1.1 Consonants</h2>
  <p class="mono">${escapeHtml(consonants.join("  ") || "—")}</p>
  <h2>1.2 Vowels</h2>
  <p class="mono">${escapeHtml(vowels.join("  ") || "—")}</p>
  <h2>1.3 Syllable Structure</h2>
  <p class="mono">${escapeHtml(phono.phonotactics.syllable_structure || "—")}</p>
  ${romanizationRows.length > 0 ? `<h2>1.4 Romanization</h2>${table(["Grapheme", "Phoneme", "Context"], romanizationRows)}` : ""}
</section>`;
}

function renderTypology(options: ReferenceBookOptions): string {
  const { grammar } = options;
  const syntax = grammar.syntax;
  const typology = grammar.typology;
  return `
<section id="typology">
  <h1>2. Typology &amp; Syntax</h1>
  <dl class="facts">
    <dt>Morphological type</dt><dd>${escapeHtml(typology.morphological_type)}</dd>
    <dt>Synthesis index</dt><dd>${typology.synthesis_index}</dd>
    <dt>Fusion index</dt><dd>${typology.fusion_index}</dd>
    <dt>Head marking</dt><dd>${escapeHtml(typology.head_marking)}</dd>
    <dt>Word order</dt><dd>${escapeHtml(syntax.word_order)}</dd>
    <dt>Alignment</dt><dd>${escapeHtml(syntax.alignment ?? "nom_acc")}</dd>
    <dt>Modifier position</dt><dd>${escapeHtml(syntax.modifier_position)}</dd>
    <dt>Adposition type</dt><dd>${escapeHtml(syntax.adposition_type)}</dd>
  </dl>
</section>`;
}

interface ParadigmTable {
  title: string;
  headers: string[];
  rows: string[][];
}

function buildParadigms(options: ReferenceBookOptions): ParadigmTable[] {
  const { grammar, phono, words } = options;
  const tables: ParadigmTable[] = [];
  for (const pos of grammar.parts_of_speech) {
    const sample = words.find((word) => word.senses.some((sense) => sense.pos_id === pos.pos_id));
    const testWord = sample?.con_word_romanized ?? "tami";
    const rows = generateParadigm(
      testWord,
      pos.pos_id,
      grammar.inflection_rules,
      phono,
      { entryId: sample?.entry_id ?? "reference", grammar },
    );
    if (rows.length === 0) continue;
    tables.push({
      title: `${pos.name} — ${testWord}`,
      headers: ["Tag", "Dimensions", "Form"],
      rows: rows.map((row) => [
        row.tag,
        Object.entries(row.dimensionValues)
          .map(([dimId, valId]) => `${dimensionName(grammar, dimId)}=${valId}`)
          .join(", "),
        row.result,
      ]),
    });
  }
  return tables;
}

/** 范式单元格：本族文字在上、罗马字在下（无内嵌字体时保持纯文本） */
function paradigmFormCell(form: string, options: ReferenceBookOptions, context: RenderContext): TableCell {
  if (!options.fontBase64) return form;
  const nativeText = textToFontText(form, options.phono, context.fontIndex);
  if (!nativeText || nativeText === form) return form;
  return {
    html: `<span class="conlang">${escapeHtml(nativeText)}</span><br/><span class="romanized">${escapeHtml(form)}</span>`,
  };
}

function renderParadigms(options: ReferenceBookOptions, context: RenderContext): string {
  const tables = buildParadigms(options);
  if (tables.length === 0) {
    return `<section id="paradigms"><h1>3. Paradigms</h1><p>No inflection rules defined.</p></section>`;
  }
  return `
<section id="paradigms">
  <h1>3. Paradigms</h1>
  ${tables
    .map(
      (item) =>
        `<h2>${escapeHtml(item.title)}</h2>${table(
          item.headers,
          item.rows.map((row) => [
            row[0] ?? "",
            row[1] ?? "",
            paradigmFormCell(row[2] ?? "", options, context),
          ]),
          "paradigm",
        )}`,
    )
    .join("\n")}
</section>`;
}

function paradigmMacro(
  chapter: GrammarChapter,
  options: ReferenceBookOptions,
): (match: string, paradigmId: string) => string {
  return (_match, paradigmId) => {
    const embedded = chapter.embedded_paradigms.find(
      (item) => item.paradigm_id === paradigmId,
    );
    if (!embedded) return `<em>[missing paradigm: ${escapeHtml(paradigmId)}]</em>`;
    const rules = options.grammar.inflection_rules.filter(
      (rule) => rule.pos_id === embedded.pos_id && !rule.disabled,
    );
    const rows = rules
      .filter((rule) =>
        embedded.dimension_ids.every((dimId) => rule.dimension_values[dimId] !== undefined),
      )
      .map((rule) => [rule.tag, rule.affix]);
    return table([embedded.test_word, "Affix"], rows, "paradigm");
  };
}

function renderManual(options: ReferenceBookOptions): string {
  const chapters = [...options.grammar.grammar_manual].sort((a, b) => a.order - b.order);
  if (chapters.length === 0) {
    return `<section id="manual"><h1>4. Grammar Manual</h1><p>No chapters written yet.</p></section>`;
  }
  const content = chapters
    .map((chapter) => {
      // 先转义原文，再把宏替换为受控 HTML（避免把生成的表格二次转义）
      const body = escapeHtml(chapter.content).replace(
        /\{\{paradigm:([A-Za-z0-9_-]+)\}\}/g,
        paradigmMacro(chapter, options),
      );
      return `<h2>${escapeHtml(chapter.title)}</h2><div class="markdown">${body.replace(/\n/g, "<br/>")}</div>`;
    })
    .join("\n");
  return `<section id="manual"><h1>4. Grammar Manual</h1>${content}</section>`;
}

function renderCorpus(options: ReferenceBookOptions, context: RenderContext): string {
  const corpora = options.corpus ?? [];
  if (corpora.length === 0) {
    return `<section id="corpus"><h1>5. Glossed Texts</h1><p>No corpus texts yet.</p></section>`;
  }
  const blocks = corpora
    .map((corpus) => {
      const lines = corpus.glossed_lines
        .map((line) => {
          const surface = line.tokens.map((token) => token.surface_form).join("  ");
          const morphemes = line.tokens.map((token) => token.morpheme_break).join("  ");
          const glosses = line.tokens.map((token) => token.gloss_labels).join("  ");
          const nativeText = options.fontBase64
            ? textToFontText(surface, options.phono, context.fontIndex)
            : "";
          const nativeLine =
            nativeText && nativeText !== surface
              ? `\n  <div class="conlang native-line">${escapeHtml(nativeText)}</div>`
              : "";
          return `<div class="corpus-line">${nativeLine}
  <div class="romanized">${escapeHtml(surface)}</div>
  <div class="gloss">${escapeHtml(morphemes)}</div>
  <div class="gloss">${escapeHtml(glosses)}</div>
  <div class="translation">‘${escapeHtml(line.translation)}’</div>
</div>`;
        })
        .join("\n");
      return `<h2>${escapeHtml(corpus.title)}</h2>${corpus.description ? `<p>${escapeHtml(corpus.description)}</p>` : ""}${lines}`;
    })
    .join("\n");
  return `<section id="corpus"><h1>5. Glossed Texts</h1>${blocks}</section>`;
}

function conceptLabel(concept: ConceptDefinition): string {
  const parts = [concept.gloss_zh, concept.gloss_en].filter((label) => Boolean(label?.trim()));
  return parts.length > 0 ? parts.join(" · ") : concept.concept_id;
}

/** 简要词源：优先显示构词成分，其次显示派生母词 */
function etymologyNote(word: WordEntry, context: RenderContext): string {
  const components = (word.etymology.components ?? [])
    .map((component) =>
      component.entry_id ? context.wordsById.get(component.entry_id)?.con_word_romanized : undefined,
    )
    .filter((form): form is string => Boolean(form));
  if (components.length > 0) {
    return `<div class="etym">&lt; ${escapeHtml(components.join(" + "))}</div>`;
  }
  const parent = word.etymology.parent_entry_id
    ? context.wordsById.get(word.etymology.parent_entry_id)
    : undefined;
  if (parent) return `<div class="etym">&lt; ${escapeHtml(parent.con_word_romanized)}</div>`;
  if (word.etymology.origin_type === "borrowed") return `<div class="etym">borrowed</div>`;
  return "";
}

function firstExample(word: WordEntry): string {
  const example = word.senses
    .flatMap((sense) => sense.examples)
    .map((item) => item.trim())
    .find((item) => item.length > 0);
  return example ? `<div class="example">‘${escapeHtml(example)}’</div>` : "";
}

function dictionaryEntry(
  word: WordEntry,
  options: ReferenceBookOptions,
  context: RenderContext,
): string {
  const senses = word.senses
    .map((sense) => {
      const concept = context.conceptOf(sense.concept_id);
      const badge = concept
        ? ` <span class="concept" title="${escapeHtml(concept.concept_id)}">${escapeHtml(conceptLabel(concept))}</span>`
        : "";
      return `<span class="pos">${escapeHtml(posName(options.grammar, sense.pos_id))}</span> ${escapeHtml(sense.gloss)}${badge}`;
    })
    .join("; ");
  const nativeText = wordToFontText(word, options.phono, context.fontIndex);
  const native = `<span class="conlang native-headword">${escapeHtml(nativeText || word.con_word_romanized)}</span>`;
  const headword = `<span class="headword">${escapeHtml(word.con_word_romanized)}</span>`;
  const ipa = word.phonetic_ipa ? ` /${escapeHtml(word.phonetic_ipa)}/` : "";
  return `<div class="entry"><div>${native} ${headword}${ipa} — ${senses}</div>${etymologyNote(word, context)}${firstExample(word)}</div>`;
}

function renderDictionary(options: ReferenceBookOptions, context: RenderContext): string {
  const words = [...options.words].sort(byRomanized);
  if (words.length === 0) {
    return `<section id="dictionary"><h1>Part I. Conlang → Meaning</h1><p>Lexicon is empty.</p></section>`;
  }
  return `<section id="dictionary">
  <h1>Part I. Conlang → Meaning</h1>
  <div class="columns">${words.map((word) => dictionaryEntry(word, options, context)).join("\n")}</div>
</section>`;
}

interface ReverseRow {
  key: string;
  detail: string;
  form: string;
}

/** Part II：每个义项与绑定概念（中/英）都生成检索项 */
function buildReverseRows(options: ReferenceBookOptions, context: RenderContext): ReverseRow[] {
  const rows: ReverseRow[] = [];
  const seen = new Set<string>();
  const push = (word: WordEntry, key: string, detail: string): void => {
    const trimmed = key.trim();
    if (!trimmed) return;
    const dedupe = `${word.entry_id}|${trimmed}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    const nativeText = wordToFontText(word, options.phono, context.fontIndex);
    const form = `<span class="conlang">${escapeHtml(nativeText || word.con_word_romanized)}</span> <span class="headword">${escapeHtml(word.con_word_romanized)}</span>`;
    rows.push({ key: trimmed, detail, form });
  };
  for (const word of options.words) {
    for (const sense of word.senses) {
      push(word, sense.gloss, posName(options.grammar, sense.pos_id));
      const concept = context.conceptOf(sense.concept_id);
      if (!concept) continue;
      if (concept.gloss_zh) push(word, concept.gloss_zh, concept.concept_id);
      if (concept.gloss_en) push(word, concept.gloss_en, concept.concept_id);
    }
  }
  return rows.sort((left, right) => left.key.localeCompare(right.key));
}

function renderReverseIndex(options: ReferenceBookOptions, context: RenderContext): string {
  const rows = buildReverseRows(options, context);
  if (rows.length === 0) {
    return `<section id="reverse"><h1>Part II. Meaning → Conlang</h1><p>No glossed senses yet.</p></section>`;
  }
  const body = rows.map(
    (row) =>
      `<div class="entry"><span class="headword">${escapeHtml(row.key)}</span> <span class="pos">${escapeHtml(row.detail)}</span> → ${row.form}</div>`,
  );
  return `<section id="reverse"><h1>Part II. Meaning → Conlang</h1><div class="columns">${body.join("\n")}</div></section>`;
}

const BOOK_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { font-family: "Libertinus Serif", "Noto Serif CJK SC", Georgia, serif; color: #1a1a1a; margin: 0; line-height: 1.5; }
.page { max-width: 46rem; margin: 0 auto; padding: 3rem 2rem; }
.cover { text-align: center; padding: 6rem 1rem 4rem; border-bottom: 1px solid #ddd; margin-bottom: 2rem; }
.cover h1 { font-size: 2.6rem; margin: 0 0 .5rem; }
.cover .native { font-size: 1.6rem; margin: .25rem 0 1.5rem; }
.cover .meta { color: #666; font-size: .9rem; }
nav.toc { margin: 2rem 0 3rem; font-size: .95rem; }
nav.toc ol { padding-left: 1.2rem; }
nav.toc a { color: #1a1a1a; text-decoration: none; }
section { margin: 0 0 2.5rem; page-break-inside: auto; }
h1 { font-size: 1.6rem; border-bottom: 1px solid #ddd; padding-bottom: .3rem; margin: 2rem 0 1rem; }
h2 { font-size: 1.15rem; margin: 1.4rem 0 .5rem; }
table { border-collapse: collapse; width: 100%; font-size: .85rem; margin: .5rem 0 1rem; }
th, td { border: 1px solid #ccc; padding: .3rem .45rem; text-align: left; vertical-align: top; }
th { background: #f4f4f4; }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: .25rem 1rem; font-size: .9rem; }
.facts dt { color: #555; }
.facts dd { margin: 0; }
.columns { column-count: 2; column-gap: 2rem; font-size: .9rem; }
.entry { break-inside: avoid; margin-bottom: .35rem; }
.headword { font-weight: 600; }
.pos { font-style: italic; color: #555; }
.concept { font-size: .72rem; color: #555; border: 1px solid #ddd; border-radius: 3px; padding: 0 .22rem; }
.etym, .example { font-size: .8rem; color: #555; }
.mono, .conlang { font-family: "ConlangBook", "Libertinus Serif", serif; }
.corpus-line { margin: 0 0 1rem; page-break-inside: avoid; }
.corpus-line .gloss { font-size: .85rem; color: #444; }
.corpus-line .translation { font-size: .9rem; font-style: italic; margin-top: .2rem; }
.native, .conlang, .entry .headword { font-variant-ligatures: common-ligatures contextual; }
@media print { .page { max-width: none; padding: 0; } nav.toc { page-break-after: always; } h1 { page-break-after: avoid; } }
`;

function isOpenTypeFont(options: ReferenceBookOptions): boolean {
  return (
    (options.fontMime ?? "").toLowerCase().includes("otf") ||
    /\.otf$/i.test(options.fontFileName ?? "")
  );
}

function fontSettingsCss(features: readonly string[]): string {
  try {
    return fontFeaturesToCss(features);
  } catch (error) {
    console.warn(`Invalid font feature configuration: ${error}`);
    return fontFeaturesToCss();
  }
}

function buildBookCss(options: ReferenceBookOptions): string {
  return `${BOOK_CSS}\n.conlang { font-feature-settings: ${fontSettingsCss(options.phono.font_features ?? [])}; }\n`;
}

function buildFontFace(options: ReferenceBookOptions): string {
  if (!options.fontBase64) return "";
  const openType = isOpenTypeFont(options);
  const mime = options.fontMime ?? (openType ? "font/otf" : "font/ttf");
  const format = openType ? "opentype" : "truetype";
  return `@font-face { font-family: "ConlangBook"; src: url("data:${mime};base64,${options.fontBase64}") format("${format}"); font-display: block; }`;
}

function buildToc(options: ReferenceBookOptions): string {
  const items: string[] = [];
  if (options.sections.phonology) items.push('<li><a href="#phonology">1. Phonology</a></li>');
  if (options.sections.typology) items.push('<li><a href="#typology">2. Typology &amp; Syntax</a></li>');
  if (options.sections.paradigms) items.push('<li><a href="#paradigms">3. Paradigms</a></li>');
  if (options.sections.manual) items.push('<li><a href="#manual">4. Grammar Manual</a></li>');
  if (options.sections.corpus) items.push('<li><a href="#corpus">5. Glossed Texts</a></li>');
  if (options.sections.dictionary) items.push('<li><a href="#dictionary">Part I. Conlang → Meaning</a></li>');
  if (options.sections.reverseIndex) items.push('<li><a href="#reverse">Part II. Meaning → Conlang</a></li>');
  return `<nav class="toc"><h2>Contents</h2><ol>${items.join("")}</ol></nav>`;
}

export function buildReferenceBookHtml(options: ReferenceBookOptions): string {
  const generatedAt = options.generatedAt ?? new Date().toISOString().slice(0, 10);
  const context = buildContext(options, true);

  const body = [
    options.sections.phonology ? renderPhonology(options) : "",
    options.sections.typology ? renderTypology(options) : "",
    options.sections.paradigms ? renderParadigms(options, context) : "",
    options.sections.manual ? renderManual(options) : "",
    options.sections.corpus ? renderCorpus(options, context) : "",
    options.sections.dictionary ? renderDictionary(options, context) : "",
    options.sections.reverseIndex ? renderReverseIndex(options, context) : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(options.languageName)} — Reference Grammar</title>
<style>${buildFontFace(options)}${buildBookCss(options)}</style>
</head>
<body>
<div class="page">
<header class="cover">
  <h1>${escapeHtml(options.languageName)}</h1>
  ${options.nativeName ? `<div class="native conlang">${escapeHtml(options.nativeName)}</div>` : ""}
  <div class="meta">Reference Grammar &amp; Dictionary${options.author ? ` · ${escapeHtml(options.author)}` : ""} · ${escapeHtml(generatedAt)}</div>
</header>
${buildToc(options)}
${body}
</div>
</body>
</html>`;
}

export function buildReferenceBookTypst(options: ReferenceBookOptions): string {
  const lines: string[] = [
    '#set page(paper: "a4", margin: 2cm)',
    '#set text(font: ("Libertinus Serif", "Noto Serif CJK SC"), size: 10pt)',
    '#set heading(numbering: "1.1")',
    `#align(center)[#text(size: 24pt, weight: "bold")[${escapeTypst(options.languageName)}]]`,
  ];
  if (options.nativeName) {
    lines.push(`#align(center)[#text(size: 16pt)[${escapeTypst(options.nativeName)}]]`);
  }
  lines.push("#pagebreak()", "= Contents", "");

  if (options.sections.phonology) {
    lines.push(
      "= Phonology",
      `Consonants: ${escapeTypst(options.phono.phoneme_inventory.consonants.join(" "))}`,
      `Vowels: ${escapeTypst(options.phono.phoneme_inventory.vowels.join(" "))}`,
      `Syllable structure: ${escapeTypst(options.phono.phonotactics.syllable_structure)}`,
      "",
    );
  }
  if (options.sections.typology) {
    lines.push(
      "= Typology and Syntax",
      `- Morphological type: ${escapeTypst(options.grammar.typology.morphological_type)}`,
      `- Word order: ${escapeTypst(options.grammar.syntax.word_order)}`,
      `- Alignment: ${escapeTypst(options.grammar.syntax.alignment ?? "nom_acc")}`,
      "",
    );
  }
  if (options.sections.paradigms) {
    lines.push("= Paradigms");
    for (const item of buildParadigms(options)) {
      lines.push(`== ${escapeTypst(item.title)}`);
      lines.push(
        `#table(columns: ${item.headers.length}, ${item.headers.map((header) => `[${escapeTypst(header)}]`).join(", ")}, ${item.rows
          .flat()
          .map((cell) => `[${escapeTypst(cell)}]`)
          .join(", ")})`,
        "",
      );
    }
  }
  if (options.sections.manual) {
    lines.push("= Grammar Manual");
    for (const chapter of [...options.grammar.grammar_manual].sort((a, b) => a.order - b.order)) {
      lines.push(`== ${escapeTypst(chapter.title)}`, escapeTypst(chapter.content), "");
    }
  }
  if (options.sections.corpus) {
    lines.push("= Glossed Texts");
    for (const corpus of options.corpus ?? []) {
      lines.push(`== ${escapeTypst(corpus.title)}`);
      for (const line of corpus.glossed_lines) {
        lines.push(
          escapeTypst(line.tokens.map((token) => token.surface_form).join("  ")),
          escapeTypst(line.tokens.map((token) => token.gloss_labels).join("  ")),
          `_${escapeTypst(line.translation)}_`,
          "",
        );
      }
    }
  }
  if (options.sections.dictionary) {
    lines.push("= Part I. Conlang to Meaning");
    for (const word of [...options.words].sort(byRomanized)) {
      lines.push(
        `- *${escapeTypst(word.con_word_romanized)}*${word.phonetic_ipa ? ` /${escapeTypst(word.phonetic_ipa)}/` : ""}: ${escapeTypst(word.senses.map((sense) => sense.gloss).join("; "))}`,
      );
    }
  }
  if (options.sections.reverseIndex) {
    lines.push("", "= Part II. Meaning to Conlang");
    const entries = options.words
      .flatMap((word) =>
        senseGlosses(word).map((gloss) => ({ gloss, form: word.con_word_romanized })),
      )
      .sort((left, right) => left.gloss.localeCompare(right.gloss));
    for (const entry of entries) {
      lines.push(`- *${escapeTypst(entry.gloss)}*: ${escapeTypst(entry.form)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
