/**
 * e2e-v3-smoke.mts — Roadmap v3 单语言端到端核验（代表语言：lang_child）
 *
 * 覆盖：词源追溯链 / 同源矩阵创新与断链 / 变位一致性与规则顺序无关 /
 * 语料非破坏标注（默认 fill_empty 保留句译与人工 token）。
 *
 * 运行：bun scripts/e2e-v3-smoke.mts
 */
import fs from "node:fs";
import path from "node:path";
import { buildEtymologyLineage } from "../src/core/engines/etymologyLineage";
import { buildCognateMatrix } from "../src/core/engines/cognateMatrix";
import { inflectWord } from "../src/core/engines/morphologyEngine";
import { autoGloss, mergeAutoGlossIntoCorpus } from "../src/core/workflows/autoGloss";
import type {
  CorpusText,
  GrammarConfig,
  PhonologyConfig,
  WordEntry,
  WorkspaceConfig,
} from "../src/types";

const ROOT = path.resolve(import.meta.dir, "..", "tests/fixtures/workspace-basic");

function readJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf-8")) as T;
}

function readLexicon(rel: string): WordEntry[] {
  const dir = path.join(ROOT, rel, "lexicon");
  const words: WordEntry[] = [];
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".ndjson"))) {
    for (const line of fs.readFileSync(path.join(dir, file), "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        words.push(JSON.parse(line) as WordEntry);
      } catch {
        // 夹具刻意保留坏行，模拟真实读取时跳过损坏记录的语义
        console.warn(`skip malformed lexicon line in ${rel}/${file}`);
      }
    }
  }
  return words;
}

const workspace = readJson<WorkspaceConfig>("workspace.conlang");
const childGrammar = readJson<GrammarConfig>("stages/child/grammar.json");
const childPhono = readJson<PhonologyConfig>("stages/child/phonology.json");
const rootWords = readLexicon("roots/root");
const childWords = readLexicon("stages/child");
const results: Array<{ name: string; ok: boolean; detail: string }> = [];

function check(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
}

// ── 1. 词源追溯链：继承词可上溯到根语词条 ──────────────────────────
const sana = childWords.find((word) => word.entry_id === "entry_root_sana");
if (!sana) throw new Error("fixture missing entry_root_sana");
const lineage = buildEtymologyLineage({
  word: sana,
  activeLanguageId: "lang_child",
  languages: workspace.languages,
  wordsByLanguage: {
    lang_child: Object.fromEntries(childWords.map((word) => [word.entry_id, word])),
    lang_root: Object.fromEntries(rootWords.map((word) => [word.entry_id, word])),
  },
});
const inheritedNode = lineage.nodes.find((node) => node.stepKind === "inherited");
check(
  "词源追溯链（继承词上溯根语）",
  Boolean(inheritedNode) && inheritedNode?.entryId === "entry_root_sana" && !lineage.hasBrokenLinks,
  `nodes=${lineage.nodes.map((node) => `${node.stepKind}:${node.entryId}`).join(" → ")}`,
);

// ── 2. 同源矩阵：继承词入同源组，本语言新词标记 innovation，零断链 ──
const conceptOf = new Map([
  ["entry_root_apa", "water"],
  ["entry_root_acika", "river"],
  ["entry_child_achama", "hearth"],
  ["entry_child_shula", "star"],
]);
const boundChild = childWords.map((word) => {
  const conceptId = conceptOf.get(word.entry_id);
  if (!conceptId) return word;
  return {
    ...word,
    senses: word.senses.map((sense) => ({ ...sense, concept_id: conceptId })),
  };
});
const concepts = [
  { concept_id: "water", gloss_zh: "水", gloss_en: "water", semantic_field: "nature" },
  { concept_id: "river", gloss_zh: "河", gloss_en: "river", semantic_field: "nature" },
  { concept_id: "hearth", gloss_zh: "炉", gloss_en: "hearth", semantic_field: "culture" },
  { concept_id: "star", gloss_zh: "星", gloss_en: "star", semantic_field: "nature" },
];
const matrix = buildCognateMatrix({
  languages: workspace.languages,
  wordsByLanguage: { lang_child: boundChild, lang_root: rootWords },
  concepts,
  maxRows: Number.MAX_SAFE_INTEGER,
});
const hearthRow = matrix.rows.find((row) => row.conceptId === "hearth");
const hearthCell = hearthRow?.cells.find((cell) => cell.languageId === "lang_child");
const waterRow = matrix.rows.find((row) => row.conceptId === "water");
const waterSets = new Set(
  waterRow?.cells.filter((cell) => cell.cognateSetId).map((cell) => cell.cognateSetId),
);
check(
  "同源矩阵（创新词分类 + 同源组 + 零断链）",
  hearthCell?.kind === "innovation" && matrix.stats.brokenChainCount === 0 && waterSets.size === 1,
  `hearth=${hearthCell?.kind}/${hearthCell?.innovationKind} sets=${matrix.stats.cognateSetCount} broken=${matrix.stats.brokenChainCount}`,
);

// ── 3. 变位一致：PL 词形正确，且规则顺序变化不影响输出 ─────────────
const achama = childWords.find((word) => word.entry_id === "entry_child_achama");
if (!achama) throw new Error("fixture missing entry_child_achama");
const plural = inflectWord({
  stem: achama.con_word_romanized,
  posId: "pos_noun",
  dimensions: { dim_num: "val_pl" },
  grammar: childGrammar,
  phono: childPhono,
  entry: achama,
});
const reversedGrammar: GrammarConfig = {
  ...childGrammar,
  inflection_rules: [...childGrammar.inflection_rules].reverse(),
};
const pluralReversed = inflectWord({
  stem: achama.con_word_romanized,
  posId: "pos_noun",
  dimensions: { dim_num: "val_pl" },
  grammar: reversedGrammar,
  phono: childPhono,
  entry: achama,
});
check(
  "变位类推导一致（含规则顺序无关）",
  plural.surface_form === "achamata" &&
    pluralReversed.surface_form === plural.surface_form &&
    plural.gloss_labels.includes("PL"),
  `${plural.surface_form} / ${pluralReversed.surface_form} · ${plural.gloss_labels} · steps=${plural.steps.length}`,
);

// ── 4. 语料非破坏标注：fill_empty 保留句译与人工 token ─────────────
const corpusText = "achama apa";
const glossed = autoGloss({
  originalText: corpusText,
  words: boundChild,
  grammar: childGrammar,
  phono: childPhono,
  createLineId: () => "line_e2e",
  createTokenId: (() => {
    let index = 0;
    return () => `tok_e2e_${(index += 1)}`;
  })(),
});
const corpus: CorpusText = {
  corpus_id: "corpus_e2e",
  language_id: "lang_child",
  title: "E2E",
  description: "",
  original_text: corpusText,
  free_translation: "",
  glossed_lines: [
    {
      line_id: "line_e2e",
      original: corpusText,
      translation: "炉与水",
      tokens: [
        {
          token_id: "tok_e2e_1",
          surface_form: "achama",
          morpheme_break: "achama",
          gloss_labels: "hearth(custom)",
          linked_entry_id: "entry_child_achama",
          ipa: "",
          status: "edited",
        },
        {
          token_id: "tok_e2e_2",
          surface_form: "apa",
          morpheme_break: "",
          gloss_labels: "",
          linked_entry_id: "",
          ipa: "",
        },
      ],
    },
  ],
  metadata: { tags: [], created_at: "", updated_at: "" },
};
const merged = mergeAutoGlossIntoCorpus({
  corpus,
  freshLines: glossed.lines,
  mode: "fill_empty",
});
const line = merged.nextLines[0];
check(
  "语料非破坏标注（fill_empty 保护句译与人工 token）",
  line?.translation === "炉与水" &&
    line?.tokens[0]?.gloss_labels === "hearth(custom)" &&
    line?.tokens[1]?.gloss_labels === "water" &&
    merged.replacedProtectedTokens.length === 0,
  `translation=${line?.translation} token1=${line?.tokens[0]?.gloss_labels} token2=${line?.tokens[1]?.gloss_labels}`,
);

// ── 汇总 ───────────────────────────────────────────────────────────
let failed = 0;
for (const item of results) {
  if (!item.ok) failed += 1;
  console.log(`${item.ok ? "✅" : "❌"} ${item.name}\n   ${item.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) process.exit(1);
