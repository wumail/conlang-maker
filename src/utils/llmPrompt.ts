/**
 * LLM Prompt 模板导出
 * 一键将当前语言的完整信息导出为 Markdown 格式 Prompt
 * 用户可复制到 ChatGPT / Claude / Gemini 等使用
 */
import {
  PhonologyConfig,
  GrammarConfig,
  WordEntry,
  SCAConfig,
  CorpusText,
  LanguageEntry,
} from "../types";

export interface PromptExportOptions {
  langName: string;
  phonoConfig: PhonologyConfig;
  grammarConfig: GrammarConfig;
  words: WordEntry[];
  scaConfig?: SCAConfig;
  corpusTexts?: CorpusText[];
  languages?: LanguageEntry[];
  /** 最大导出词条数（避免 prompt 过长） */
  maxWords?: number;
}

// ── Internal helpers ─────────────────────────────────────

function sec(title: string, level = 2): string {
  return `${"#".repeat(level)} ${title}\n`;
}

function buildPosLookup(
  grammarConfig: GrammarConfig,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of grammarConfig.parts_of_speech) {
    m.set(p.pos_id, p.gloss_abbr || p.name);
  }
  return m;
}

function dimValueLabel(
  grammarConfig: GrammarConfig,
  dimId: string,
  valId: string,
): string {
  const dim = grammarConfig.inflection_dimensions.find(
    (d) => d.dim_id === dimId,
  );
  if (!dim) return valId;
  const v = dim.values.find((dv) => dv.val_id === valId);
  return v ? (v.gloss || v.name) : valId;
}

function formatDimValues(
  grammarConfig: GrammarConfig,
  mapping: Record<string, string>,
): string {
  return Object.entries(mapping)
    .map(([dId, vId]) => dimValueLabel(grammarConfig, dId, vId))
    .join(".");
}

// ── Main generator ───────────────────────────────────────

export function generateLLMPrompt(opts: PromptExportOptions): string {
  const {
    langName,
    phonoConfig,
    grammarConfig,
    words,
    scaConfig,
    corpusTexts,
    languages,
    maxWords = 200,
  } = opts;
  const posLookup = buildPosLookup(grammarConfig);
  const s: string[] = [];

  // ── Header ──
  s.push(`# ${langName} — Language Reference Prompt\n`);
  s.push(
    `You are a linguistic expert helping me develop **${langName}**, a constructed language (conlang). Below is the complete reference grammar, phonology, and lexicon. Use this data to answer questions, generate new words, analyze sentences, and suggest improvements.\n`,
  );

  // ── 1. Language family ──
  if (languages && languages.length > 1) {
    s.push(sec("Language Family"));
    for (const l of languages) {
      const parent = l.parent_id
        ? languages.find((p) => p.language_id === l.parent_id)?.name ?? l.parent_id
        : "(root)";
      s.push(`- **${l.name}** ← ${parent}`);
    }
    s.push("");
  }

  // ── 2. Typology ──
  const typo = grammarConfig.typology;
  if (typo) {
    s.push(sec("Typological Profile"));
    s.push(`- **Morphological Type**: ${typo.morphological_type}`);
    s.push(`- **Synthesis Index**: ${typo.synthesis_index.toFixed(1)}`);
    s.push(`- **Fusion Index**: ${typo.fusion_index.toFixed(1)}`);
    s.push(`- **Head Marking**: ${typo.head_marking}`);
    s.push("");
  }

  // ── 3. Phoneme Inventory ──
  s.push(sec("Phoneme Inventory"));
  s.push(`**Consonants** (${phonoConfig.phoneme_inventory.consonants.length}): ${phonoConfig.phoneme_inventory.consonants.join(" ")}\n`);
  s.push(`**Vowels** (${phonoConfig.phoneme_inventory.vowels.length}): ${phonoConfig.phoneme_inventory.vowels.join(" ")}\n`);

  // ── 4. Tone System ──
  const tone = phonoConfig.phonotactics.tone_system;
  if (tone?.enabled && tone.tones.length > 0) {
    s.push(sec("Tone System"));
    s.push("| Tone | Marker |");
    s.push("|---|---|");
    for (const t of tone.tones) {
      s.push(`| ${t.name} | ${t.marker} |`);
    }
    s.push("");
  }

  // ── 5. Syllable Structure & Phonotactics ──
  const pt = phonoConfig.phonotactics;
  if (pt.syllable_structure) {
    s.push(sec("Syllable Structure & Phonotactics"));
    s.push(`Template: \`${pt.syllable_structure}\`\n`);
    if (Object.keys(pt.macros).length > 0) {
      s.push("**Macros**\n");
      for (const [k, v] of Object.entries(pt.macros)) {
        s.push(`- **${k}**: ${v.join(", ")}`);
      }
      s.push("");
    }
    if (pt.blacklist_patterns.length > 0) {
      s.push(`**Disallowed Patterns**: ${pt.blacklist_patterns.map((p) => `\`${p}\``).join(", ")}\n`);
    }
  }

  // ── 6. Vowel Harmony ──
  const vh = pt.vowel_harmony;
  if (vh?.enabled) {
    s.push(sec("Vowel Harmony"));
    s.push(`- **Group A**: ${vh.group_a.join(" ")}`);
    s.push(`- **Group B**: ${vh.group_b.join(" ")}`);
    s.push("");
  }

  // ── 7. Allophony Rules ──
  if (phonoConfig.allophony_rules.length > 0) {
    s.push(sec("Allophony / Phonological Rules"));
    s.push("| # | Rule | Description |");
    s.push("|---|---|---|");
    for (let i = 0; i < phonoConfig.allophony_rules.length; i++) {
      const r = phonoConfig.allophony_rules[i];
      const env =
        (r.context_before || "#") + " _ " + (r.context_after || "#");
      s.push(
        `| ${i + 1} | ${r.target} → ${r.replacement} / ${env} | ${r.description} |`,
      );
    }
    s.push("");
  }

  // ── 8. Romanization ──
  const defaultMap = phonoConfig.romanization_maps.find((m) => m.is_default) ?? phonoConfig.romanization_maps[0];
  if (defaultMap && defaultMap.rules.length > 0) {
    s.push(sec("Romanization"));
    s.push(`Mapping: **${defaultMap.name}**\n`);
    s.push("| IPA | Romanized | Context |");
    s.push("|---|---|---|");
    for (const rule of defaultMap.rules) {
      const ctx =
        (rule.context_before ? `after ${rule.context_before}` : "") +
        (rule.context_after ? ` before ${rule.context_after}` : "") || "—";
      s.push(`| ${rule.input} | ${rule.output_phoneme} | ${ctx} |`);
    }
    s.push("");
  }

  // ── 9. Syntax ──
  s.push(sec("Syntax"));
  s.push(`- **Word Order**: ${grammarConfig.syntax.word_order}`);
  s.push(`- **Modifier Position**: ${grammarConfig.syntax.modifier_position}`);
  s.push(`- **Adposition Type**: ${grammarConfig.syntax.adposition_type}`);
  s.push("");

  // ── 10. Parts of Speech ──
  if (grammarConfig.parts_of_speech.length > 0) {
    s.push(sec("Parts of Speech"));
    s.push("| Abbr | Name | Pattern |");
    s.push("|---|---|---|");
    for (const pos of grammarConfig.parts_of_speech) {
      s.push(
        `| ${pos.gloss_abbr} | ${pos.name} | ${pos.word_pattern || "—"} |`,
      );
    }
    s.push("");
  }

  // ── 11. Inflection Dimensions ──
  if (grammarConfig.inflection_dimensions.length > 0) {
    s.push(sec("Inflection Dimensions"));
    for (const dim of grammarConfig.inflection_dimensions) {
      const applies = dim.applies_to_pos
        .map((id) => posLookup.get(id) ?? id)
        .join(", ");
      s.push(
        `- **${dim.name}** (applies to: ${applies}): ${dim.values.map((v) => `${v.name} [${v.gloss}]`).join(", ")}`,
      );
    }
    s.push("");
  }

  // ── 12. Affix Slots (agglutinative) ──
  if (grammarConfig.affix_slots.length > 0) {
    s.push(sec("Affix Slot Order"));
    const sorted = [...grammarConfig.affix_slots].sort(
      (a, b) => a.position - b.position,
    );
    s.push("| Position | Label | Dimension | Obligatory |");
    s.push("|---|---|---|---|");
    for (const slot of sorted) {
      const dimName =
        grammarConfig.inflection_dimensions.find(
          (d) => d.dim_id === slot.dimension_id,
        )?.name ?? slot.dimension_id;
      s.push(
        `| ${slot.position} | ${slot.label} | ${dimName} | ${slot.is_obligatory ? "yes" : "no"} |`,
      );
    }
    s.push("");
  }

  // ── 13. Conjugation Classes (fusional) ──
  if (grammarConfig.conjugation_classes.length > 0) {
    s.push(sec("Conjugation Classes"));
    for (const cc of grammarConfig.conjugation_classes) {
      const posLabel = posLookup.get(cc.applies_to_pos) ?? cc.applies_to_pos;
      s.push(
        `- **${cc.name}** (${posLabel}): stem pattern \`${cc.stem_pattern}\`, ${cc.rule_ids.length} rules`,
      );
    }
    s.push("");
  }

  // ── 14. Inflection Rules ──
  if (grammarConfig.inflection_rules.length > 0) {
    const active = grammarConfig.inflection_rules.filter((r) => !r.disabled);
    s.push(sec("Inflection Rules", 2));
    s.push(`${active.length} active rules (${grammarConfig.inflection_rules.length - active.length} disabled)\n`);
    s.push("| POS | Dimensions | Type | Affix | Tag |");
    s.push("|---|---|---|---|---|");
    for (const r of active) {
      const posLabel = posLookup.get(r.pos_id) ?? r.pos_id;
      const dims = formatDimValues(grammarConfig, r.dimension_values);
      s.push(`| ${posLabel} | ${dims} | ${r.type} | ${r.affix} | ${r.tag || "—"} |`);
    }
    s.push("");
  }

  // ── 15. Derivation Rules ──
  if (grammarConfig.derivation_rules.length > 0) {
    s.push(sec("Derivation Rules"));
    s.push("| Name | Source → Target | Type | Affix | Semantics |");
    s.push("|---|---|---|---|---|");
    for (const d of grammarConfig.derivation_rules) {
      const src = posLookup.get(d.source_pos_id) ?? d.source_pos_id;
      const tgt = posLookup.get(d.target_pos_id) ?? d.target_pos_id;
      s.push(
        `| ${d.name} | ${src} → ${tgt} | ${d.type} | ${d.affix} | ${d.semantic_note || "—"} |`,
      );
    }
    s.push("");
  }

  // ── 16. Irregular Overrides ──
  if (grammarConfig.irregular_overrides.length > 0) {
    s.push(sec("Irregular Forms"));
    s.push("| Entry ID | Dimensions | Surface Form |");
    s.push("|---|---|---|");
    for (const o of grammarConfig.irregular_overrides) {
      const dims = formatDimValues(grammarConfig, o.dimension_values);
      // try to find the word for better readability
      const word = words.find((w) => w.entry_id === o.entry_id);
      const label = word ? word.con_word_romanized : o.entry_id;
      s.push(`| ${label} | ${dims} | ${o.surface_form} |`);
    }
    s.push("");
  }

  // ── 17. Grammar Manual excerpts ──
  if (grammarConfig.grammar_manual.length > 0) {
    s.push(sec("Grammar Manual"));
    const sorted = [...grammarConfig.grammar_manual].sort(
      (a, b) => a.order - b.order,
    );
    for (const ch of sorted) {
      s.push(sec(ch.title, 3));
      // include up to 500 chars per chapter to keep prompt manageable
      const content = ch.content.length > 500
        ? ch.content.slice(0, 500) + "\n\n*(truncated)*"
        : ch.content;
      s.push(content);
      s.push("");
    }
  }

  // ── 18. SCA (Sound Change) Rules ──
  if (scaConfig && scaConfig.rule_sets.length > 0) {
    s.push(sec("Historical Sound Changes (SCA)"));
    const sorted = [...scaConfig.rule_sets].sort(
      (a, b) => a.order - b.order,
    );
    for (const rs of sorted) {
      s.push(sec(rs.name, 3));
      for (const rule of rs.rules) {
        if (rule.feature_mode) {
          const tf = rule.target_features;
          const rf = rule.replacement_features;
          const target = tf
            ? [...tf.positive.map((f) => `+${f}`), ...tf.negative.map((f) => `-${f}`)].join(", ")
            : "?";
          const repl = rf
            ? [...rf.set_features.map((f) => `+${f}`), ...rf.remove_features.map((f) => `-${f}`)].join(", ")
            : "?";
          s.push(`- [${target}] → [${repl}]${rule.description ? ` — ${rule.description}` : ""}`);
        } else {
          const env =
            (rule.context_before || "#") + " _ " + (rule.context_after || "#");
          s.push(
            `- ${rule.target} → ${rule.replacement} / ${env}${rule.description ? ` — ${rule.description}` : ""}`,
          );
        }
      }
      s.push("");
    }
  }

  // ── 19. Lexicon ──
  const subset = words.slice(0, maxWords);
  s.push(sec(`Core Lexicon (${subset.length}/${words.length} entries)`));
  s.push("| Word | IPA | POS | Gloss | Definitions | Tags |");
  s.push("|---|---|---|---|---|---|");
  for (const w of subset) {
    const posIds = w.senses.map((sn) => posLookup.get(sn.pos_id) ?? sn.pos_id).join("/");
    const gloss = w.senses.map((sn) => sn.gloss).join("; ");
    const defs = w.senses
      .flatMap((sn) => sn.definitions)
      .filter(Boolean)
      .join("; ");
    const tags = w.metadata.tags.join(", ");
    s.push(
      `| ${w.con_word_romanized} | /${w.phonetic_ipa}/ | ${posIds} | ${gloss} | ${defs || "—"} | ${tags || "—"} |`,
    );
  }
  s.push("");

  // Etymologies (only for words that have meaningful data)
  const etymWords = subset.filter(
    (w) =>
      w.etymology.origin_type !== "a_priori" ||
      w.etymology.parent_entry_id ||
      w.etymology.applied_sound_changes.length > 0 ||
      w.etymology.semantic_shift_note,
  );
  if (etymWords.length > 0) {
    s.push(sec("Etymology Notes", 3));
    for (const w of etymWords) {
      const ety = w.etymology;
      const parts: string[] = [`**${w.con_word_romanized}**`];
      parts.push(`origin: ${ety.origin_type}`);
      if (ety.parent_entry_id) {
        const parent = words.find((p) => p.entry_id === ety.parent_entry_id);
        parts.push(`from: ${parent ? parent.con_word_romanized : ety.parent_entry_id}`);
      }
      if (ety.applied_sound_changes.length > 0) {
        parts.push(`changes: ${ety.applied_sound_changes.join(" > ")}`);
      }
      if (ety.semantic_shift_note) {
        parts.push(`shift: ${ety.semantic_shift_note}`);
      }
      s.push(`- ${parts.join(" | ")}`);
    }
    s.push("");
  }

  // ── 20. Corpus Samples ──
  if (corpusTexts && corpusTexts.length > 0) {
    s.push(sec("Corpus Samples"));
    // Include up to 5 texts
    const samples = corpusTexts.slice(0, 5);
    for (const ct of samples) {
      s.push(sec(ct.title, 3));
      if (ct.original_text) {
        s.push(`> ${ct.original_text}\n`);
      }
      if (ct.glossed_lines.length > 0) {
        s.push("**Interlinear Gloss:**\n");
        for (const line of ct.glossed_lines) {
          if (line.tokens.length > 0) {
            s.push(line.tokens.map((t) => t.surface_form).join(" "));
            s.push(line.tokens.map((t) => t.morpheme_break || t.surface_form).join(" "));
            s.push(line.tokens.map((t) => t.gloss_labels || "?").join(" "));
          }
          if (line.translation) {
            s.push(`'${line.translation}'`);
          }
          s.push("");
        }
      }
      if (ct.free_translation) {
        s.push(`**Translation:** ${ct.free_translation}\n`);
      }
    }
  }

  // ── Suggested Prompts ──
  s.push(sec("Suggested Prompt Questions"));
  s.push(
    "1. Analyze my phoneme inventory for symmetry and typological plausibility.",
  );
  s.push(
    "2. Generate 10 new words following my phonotactic rules for common daily vocabulary.",
  );
  s.push(
    `3. Given this sentence in ${langName}, provide a full morpheme-by-morpheme gloss.`,
  );
  s.push(
    "4. What gaps exist in my lexicon compared to the Swadesh 207 list?",
  );
  s.push(
    "5. Suggest a naturalistic sound change sequence to evolve a daughter language.",
  );
  s.push(
    "6. Review my inflection system for consistency and suggest improvements.",
  );
  s.push(
    "7. Generate a short narrative passage using the grammar and lexicon above.",
  );

  return s.join("\n");
}

/** 将 prompt 下载为 .md 文件 */
export function exportPromptAsMarkdown(opts: PromptExportOptions): void {
  const content = generateLLMPrompt(opts);
  const safeName = opts.langName.replace(/[^a-zA-Z0-9_-]/g, "_") || "conlang";
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName}_llm_prompt.md`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 将 prompt 复制到剪贴板 */
export async function copyPromptToClipboard(opts: PromptExportOptions): Promise<void> {
  const content = generateLLMPrompt(opts);
  await navigator.clipboard.writeText(content);
}
