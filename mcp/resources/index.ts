import path from "node:path";
import {
  ResourceTemplate,
  type McpServer,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { generateLLMPrompt } from "../../src/core/engines/llmPrompt";
import { unicodeBlockId } from "../../src/core/engines/unicodeBlocks";
import type {
  CorpusText,
  GrammarConfig,
  LanguageEntry,
} from "../../src/types";
import type { McpConfig } from "../config";
import { McpError, normalizeToMcpError } from "../errors";
import { loadFontFromBytes } from "../font/loader";
import {
  assertPathAllowed,
  assertSafeRelativeLanguagePath,
  readRegistry,
  resolveFamily,
  resolveLanguage,
  type ResolvedFamily,
} from "../registry/addressing";
import {
  findOwnFontFile,
  inspectLegacyWritingUnlocked,
  listLanguageFontStatusesUnlocked,
  readCorpusIndexUnlocked,
  readCorpusTextUnlocked,
  readGrammarUnlocked,
  readLexiconUnlocked,
  readPhonologyUnlocked,
  readScaUnlocked,
  readWorkspaceUnlocked,
  resolveFontFileUnlocked,
  withConsistentProjectRead,
} from "../storage/read";
import { computeFileRevision, MISSING_REVISION } from "../storage/revision";
import { buildAncestorChain } from "../tools/fonts_writing";
import { buildDerivedRomanizationView } from "../tools/phonology";
import { enforceMaxResponseSize } from "../util/size";

const MAX_BRIEF_BYTES = 8192;

function extractTemplateVar(
  variables: Record<string, string | string[]>,
  key: string,
): string {
  const raw = variables[key];
  const single = Array.isArray(raw) ? raw[0] : raw;
  if (typeof single !== "string" || single.trim().length === 0) {
    throw new McpError(
      "VALIDATION",
      `Missing required URI template parameter "${key}".`,
    );
  }
  try {
    return decodeURIComponent(single).trim();
  } catch {
    return single.trim();
  }
}

function isFamilyAllowed(family: ResolvedFamily, config: McpConfig): boolean {
  if (!family.exists) {
    return false;
  }
  try {
    assertPathAllowed(family.conlang_file_path, config);
    return true;
  } catch {
    return false;
  }
}

function listAllowedFamilies(config: McpConfig): ResolvedFamily[] {
  const snap = readRegistry(config);
  return snap.families.filter((f) => isFamilyAllowed(f, config));
}

function listAllowedFamilyLanguages(
  config: McpConfig,
): { family: ResolvedFamily; language: LanguageEntry }[] {
  const out: { family: ResolvedFamily; language: LanguageEntry }[] = [];
  for (const fam of listAllowedFamilies(config)) {
    try {
      const ws = readWorkspaceUnlocked(fam.conlang_file_path);
      for (const lang of ws.config.languages) {
        out.push({ family: fam, language: lang });
      }
    } catch (err) {
      console.warn(
        `[conlang-mcp] Skipping unreadable workspace "${fam.conlang_file_path}" in resource listing:`,
        err,
      );
    }
  }
  return out;
}

function jsonResourceResponse(uri: URL, payload: unknown) {
  const sized = enforceMaxResponseSize(payload);
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(sized, null, 2),
      },
    ],
  };
}

function markdownResourceResponse(uri: URL, markdown: string) {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "text/markdown",
        text: markdown,
      },
    ],
  };
}

async function runResourceRead<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error("[conlang-mcp] Resource read error:", err);
    const mcpErr = normalizeToMcpError(err);
    throw new Error(JSON.stringify(mcpErr.toPayload()));
  }
}

function computeDepthInTree(
  langId: string,
  byId: ReadonlyMap<string, LanguageEntry>,
): number {
  let depth = 0;
  const seen = new Set<string>([langId]);
  let cur = byId.get(langId)?.parent_id ?? null;
  while (cur && !seen.has(cur)) {
    const parent = byId.get(cur);
    if (!parent) break;
    seen.add(cur);
    depth += 1;
    cur = parent.parent_id ?? null;
  }
  return depth;
}

function truncateUtf8Cleanly(text: string, maxBytes: number, suffix: string): string {
  if (Buffer.byteLength(text, "utf-8") <= maxBytes) {
    return text;
  }
  const suffixBytes = Buffer.byteLength(suffix, "utf-8");
  const targetBytes = Math.max(0, maxBytes - suffixBytes);

  const lines = text.split("\n");
  const keptLines: string[] = [];
  let accBytes = 0;
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, "utf-8") + (keptLines.length > 0 ? 1 : 0);
    if (accBytes + lineBytes > targetBytes) {
      break;
    }
    keptLines.push(line);
    accBytes += lineBytes;
  }

  if (keptLines.length > 0) {
    return keptLines.join("\n") + suffix;
  }

  // Fallback codepoint-by-codepoint accumulator (never splits surrogate pairs / UTF-8 multi-byte chars)
  let out = "";
  let used = 0;
  for (const ch of Array.from(text)) {
    const chBytes = Buffer.byteLength(ch, "utf-8");
    if (used + chBytes > targetBytes) {
      break;
    }
    out += ch;
    used += chBytes;
  }
  return out + suffix;
}

function trimGrammarForCompactBrief(grammar: GrammarConfig): GrammarConfig {
  return {
    ...grammar,
    inflection_rules: grammar.inflection_rules.slice(0, 25),
    derivation_rules: grammar.derivation_rules.slice(0, 15),
    irregular_overrides: grammar.irregular_overrides.slice(0, 15),
    grammar_manual: grammar.grammar_manual.slice(0, 3).map((ch) => ({
      ...ch,
      content:
        ch.content.length > 200 ? `${ch.content.slice(0, 197)}...` : ch.content,
    })),
  };
}

function buildCompactLanguageBrief(params: {
  langName: string;
  phonoConfig: ReturnType<typeof readPhonologyUnlocked>["config"];
  grammarConfig: GrammarConfig;
  words: ReturnType<typeof readLexiconUnlocked>["words"];
  scaConfig: ReturnType<typeof readScaUnlocked>["config"];
  corpora: CorpusText[];
  languages: LanguageEntry[];
}): string {
  const activeWords = params.words.filter((w) => !w.evolution?.is_deprecated);

  // Tier 1: Rich brief with up to 40 lexicon entries and 2 corpus excerpts
  const attempt1 = generateLLMPrompt({
    langName: params.langName,
    phonoConfig: params.phonoConfig,
    grammarConfig: params.grammarConfig,
    words: activeWords,
    scaConfig: params.scaConfig,
    corpusTexts: params.corpora.slice(0, 2),
    languages: params.languages,
    maxWords: 40,
  });
  if (Buffer.byteLength(attempt1, "utf-8") <= MAX_BRIEF_BYTES) {
    return attempt1;
  }

  // Tier 2: Trimmed grammar manual/rules + 15 lexicon entries + no corpus
  const compactPhono = {
    ...params.phonoConfig,
    romanization_maps: params.phonoConfig.romanization_maps.map((m) => ({
      ...m,
      rules: m.rules.slice(0, 40),
    })),
    allophony_rules: params.phonoConfig.allophony_rules.slice(0, 15),
  };
  const attempt2 = generateLLMPrompt({
    langName: params.langName,
    phonoConfig: compactPhono,
    grammarConfig: trimGrammarForCompactBrief(params.grammarConfig),
    words: activeWords,
    scaConfig: {
      ...params.scaConfig,
      rule_sets: params.scaConfig.rule_sets.slice(0, 3).map((rs) => ({
        ...rs,
        rules: rs.rules.slice(0, 10),
      })),
    },
    corpusTexts: [],
    languages: params.languages.slice(0, 12),
    maxWords: 15,
  });
  if (Buffer.byteLength(attempt2, "utf-8") <= MAX_BRIEF_BYTES) {
    return attempt2;
  }

  const truncationNotice =
    "\n\n*(Compact brief capped at 8 KB; call `export_llm_brief` for the full reference prompt.)*\n";
  return truncateUtf8Cleanly(attempt2, MAX_BRIEF_BYTES, truncationNotice);
}

export function registerConlangResources(
  server: McpServer,
  config: McpConfig,
): void {
  const completeFamilyIds = (prefix: string): string[] => {
    const q = prefix.toLowerCase();
    return listAllowedFamilies(config)
      .map((f) => f.family_id)
      .filter((id) => id.toLowerCase().startsWith(q));
  };

  const completeLanguageIds = (
    prefix: string,
    context?: { arguments?: Record<string, string> },
  ): string[] => {
    const q = prefix.toLowerCase();
    const famArg = context?.arguments?.family_id;
    try {
      const fam = resolveFamily(config, famArg);
      const ws = readWorkspaceUnlocked(fam.conlang_file_path);
      return ws.config.languages
        .map((l) => l.language_id)
        .filter((id) => id.toLowerCase().startsWith(q));
    } catch {
      return [];
    }
  };

  // 1. conlang://families (static resource)
  server.registerResource(
    "families",
    "conlang://families",
    {
      title: "Registered Conlang Families",
      description:
        "Lists all registered conlang families in registry.json with their family_id, workspace path, active flag, and language count.",
      mimeType: "application/json",
    },
    async (uri) =>
      await runResourceRead(() => {
        const snap = readRegistry(config);
        const families = snap.families
          .filter((f) => {
            if (config.allowRoots.length === 0) return true;
            try {
              assertPathAllowed(f.conlang_file_path, config);
              return true;
            } catch {
              return false;
            }
          })
          .map((f) => {
            let languageCount = 0;
            if (f.exists) {
              try {
                const ws = readWorkspaceUnlocked(f.conlang_file_path);
                languageCount = ws.config.languages.length;
              } catch (err) {
                console.warn(
                  `[conlang-mcp] Failed reading workspace "${f.conlang_file_path}":`,
                  err,
                );
              }
            }
            return {
              family_id: f.family_id,
              name: f.name,
              conlang_file_path: f.conlang_file_path,
              project_dir: f.project_dir,
              active: f.is_active,
              last_opened: f.last_opened,
              exists: f.exists,
              language_count: languageCount,
            };
          });

        return jsonResourceResponse(uri, {
          registry_revision: snap.registry_revision,
          families,
        });
      }),
  );

  // 2. conlang://{family_id}/tree
  server.registerResource(
    "family_tree",
    new ResourceTemplate("conlang://{family_id}/tree", {
      list: async () => ({
        resources: listAllowedFamilies(config).map((f) => ({
          uri: `conlang://${encodeURIComponent(f.family_id)}/tree`,
          name: `${f.name} — Family Tree`,
          description: `Language genealogy tree for family "${f.name}" (${f.family_id})`,
          mimeType: "application/json",
        })),
      }),
      complete: {
        family_id: completeFamilyIds,
      },
    }),
    {
      title: "Language Family Tree",
      description:
        "Genealogy tree of languages in a family with parent/child links, depths, word counts, and font inheritance status.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      await runResourceRead(async () => {
        const familyId = extractTemplateVar(variables, "family_id");
        const family = resolveFamily(config, familyId);
        const data = await withConsistentProjectRead(
          family.project_dir,
          config.mode,
          "resource:family_tree",
          () => {
            const ws = readWorkspaceUnlocked(family.conlang_file_path);
            const byId = new Map(
              ws.config.languages.map((l) => [l.language_id, l]),
            );
            const childrenByParent = new Map<string, string[]>();
            for (const l of ws.config.languages) {
              if (l.parent_id) {
                const kids = childrenByParent.get(l.parent_id) ?? [];
                kids.push(l.language_id);
                childrenByParent.set(l.parent_id, kids);
              }
            }
            const fontStatuses = listLanguageFontStatusesUnlocked(
              family.project_dir,
              ws.config.languages,
            );
            const fontByLangId = new Map(
              fontStatuses.map((s) => [s.language_id, s]),
            );

            const languages = ws.config.languages.map((l) => {
              let wordCount = 0;
              try {
                const lex = readLexiconUnlocked(family.project_dir, l);
                wordCount = lex.words.filter(
                  (w) => !w.evolution?.is_deprecated,
                ).length;
              } catch (err) {
                console.warn(
                  `[conlang-mcp] Failed counting lexicon for "${l.language_id}":`,
                  err,
                );
              }
              const fsEntry = fontByLangId.get(l.language_id);
              return {
                ...l,
                parent_id: l.parent_id ?? null,
                children_ids: childrenByParent.get(l.language_id) ?? [],
                depth: computeDepthInTree(l.language_id, byId),
                word_count: wordCount,
                font_status: fsEntry ?? null,
              };
            });

            return {
              family_id: family.family_id,
              name: family.name,
              project_dir: family.project_dir,
              conlang_file_path: family.conlang_file_path,
              revision: ws.revision,
              languages,
            };
          },
        );
        return jsonResourceResponse(uri, data);
      }),
  );

  // 3. conlang://{family_id}/{language_id}/brief
  server.registerResource(
    "language_brief",
    new ResourceTemplate("conlang://{family_id}/{language_id}/brief", {
      list: async () => ({
        resources: listAllowedFamilyLanguages(config).map(
          ({ family, language }) => ({
            uri: `conlang://${encodeURIComponent(family.family_id)}/${encodeURIComponent(language.language_id)}/brief`,
            name: `${language.name} (${family.name}) — LLM Brief`,
            description: `Compact Markdown reference brief (<= 8 KB) for language "${language.name}"`,
            mimeType: "text/markdown",
          }),
        ),
      }),
      complete: {
        family_id: completeFamilyIds,
        language_id: completeLanguageIds,
      },
    }),
    {
      title: "Compact Language Reference Brief (Markdown)",
      description:
        "LLM-friendly compact Markdown reference summary (<= 8 KB) of phonology, romanization, typology, morphology, sound changes, and core lexicon.",
      mimeType: "text/markdown",
    },
    async (uri, variables) =>
      await runResourceRead(async () => {
        const familyId = extractTemplateVar(variables, "family_id");
        const languageId = extractTemplateVar(variables, "language_id");
        const family = resolveFamily(config, familyId);

        const markdown = await withConsistentProjectRead(
          family.project_dir,
          config.mode,
          "resource:language_brief",
          () => {
            const ws = readWorkspaceUnlocked(family.conlang_file_path);
            const resolved = resolveLanguage(family, languageId, {
              workspace: ws.config,
              revision: ws.revision,
            });
            const lang = resolved.language;

            const phono = readPhonologyUnlocked(
              family.project_dir,
              family.conlang_file_path,
              lang,
            );
            const grammar = readGrammarUnlocked(family.project_dir, lang);
            const sca = readScaUnlocked(family.project_dir, lang);
            const lexicon = readLexiconUnlocked(family.project_dir, lang);
            const corpusIndex = readCorpusIndexUnlocked(
              family.project_dir,
              lang,
            );
            const corpora: CorpusText[] = [];
            for (const item of corpusIndex.entries.slice(0, 2)) {
              try {
                corpora.push(
                  readCorpusTextUnlocked(
                    family.project_dir,
                    lang,
                    item.corpus_id,
                  ).corpus,
                );
              } catch (err) {
                console.warn(
                  `[conlang-mcp] Skipping unreadable corpus "${item.corpus_id}" in brief:`,
                  err,
                );
              }
            }

            return buildCompactLanguageBrief({
              langName: lang.name,
              phonoConfig: phono.effective_config ?? phono.config,
              grammarConfig: grammar.config,
              words: lexicon.words,
              scaConfig: sca.config,
              corpora,
              languages: ws.config.languages,
            });
          },
        );

        return markdownResourceResponse(uri, markdown);
      }),
  );

  // 4. conlang://{family_id}/{language_id}/phonology
  server.registerResource(
    "language_phonology",
    new ResourceTemplate("conlang://{family_id}/{language_id}/phonology", {
      list: async () => ({
        resources: listAllowedFamilyLanguages(config).map(
          ({ family, language }) => ({
            uri: `conlang://${encodeURIComponent(family.family_id)}/${encodeURIComponent(language.language_id)}/phonology`,
            name: `${language.name} (${family.name}) — Phonology`,
            description: `Local and effective phonology configuration for "${language.name}"`,
            mimeType: "application/json",
          }),
        ),
      }),
      complete: {
        family_id: completeFamilyIds,
        language_id: completeLanguageIds,
      },
    }),
    {
      title: "Language Phonology Configuration",
      description:
        "Returns local_config, effective_config (with inherited glyph_annotations if applicable), annotations_source, revisions, dependencies, and legacy_writing status.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      await runResourceRead(async () => {
        const familyId = extractTemplateVar(variables, "family_id");
        const languageId = extractTemplateVar(variables, "language_id");
        const family = resolveFamily(config, familyId);

        const payload = await withConsistentProjectRead(
          family.project_dir,
          config.mode,
          "resource:language_phonology",
          () => {
            const ws = readWorkspaceUnlocked(family.conlang_file_path);
            const resolved = resolveLanguage(family, languageId, {
              workspace: ws.config,
              revision: ws.revision,
            });
            const lang = resolved.language;
            const phono = readPhonologyUnlocked(
              family.project_dir,
              family.conlang_file_path,
              lang,
            );
            const legacyWriting = inspectLegacyWritingUnlocked(
              family.project_dir,
              lang,
            );

            return {
              family_id: family.family_id,
              language_id: lang.language_id,
              name: lang.name,
              local_config: phono.local_config ?? phono.config,
              effective_config: phono.effective_config ?? phono.config,
              annotations_source: phono.annotations_source,
              annotations_owner_id: phono.annotations_owner_id,
              revision: phono.revision,
              effective_revision: phono.effective_revision,
              dependencies: phono.dependencies,
              legacy_writing: legacyWriting,
            };
          },
        );

        return jsonResourceResponse(uri, payload);
      }),
  );

  // 5. conlang://{family_id}/{language_id}/romanization
  server.registerResource(
    "language_romanization",
    new ResourceTemplate("conlang://{family_id}/{language_id}/romanization", {
      list: async () => ({
        resources: listAllowedFamilyLanguages(config).map(
          ({ family, language }) => ({
            uri: `conlang://${encodeURIComponent(family.family_id)}/${encodeURIComponent(language.language_id)}/romanization`,
            name: `${language.name} (${family.name}) — Romanization`,
            description: `Romanization maps and derived character/rule metadata for "${language.name}"`,
            mimeType: "application/json",
          }),
        ),
      }),
      complete: {
        family_id: completeFamilyIds,
        language_id: completeLanguageIds,
      },
    }),
    {
      title: "Language Romanization Maps",
      description:
        "Returns romanization maps enriched with derived per-rule Unicode decomposition, multichar/context flags, inventory membership, and input character summary.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      await runResourceRead(async () => {
        const familyId = extractTemplateVar(variables, "family_id");
        const languageId = extractTemplateVar(variables, "language_id");
        const family = resolveFamily(config, familyId);

        const payload = await withConsistentProjectRead(
          family.project_dir,
          config.mode,
          "resource:language_romanization",
          () => {
            const ws = readWorkspaceUnlocked(family.conlang_file_path);
            const resolved = resolveLanguage(family, languageId, {
              workspace: ws.config,
              revision: ws.revision,
            });
            const lang = resolved.language;
            const phono = readPhonologyUnlocked(
              family.project_dir,
              family.conlang_file_path,
              lang,
            );
            const localCfg = phono.local_config ?? phono.config;
            const derived = buildDerivedRomanizationView(
              localCfg.romanization_maps,
              localCfg.phoneme_inventory,
            );
            const legacyWriting = inspectLegacyWritingUnlocked(
              family.project_dir,
              lang,
            );

            return {
              family_id: family.family_id,
              language_id: lang.language_id,
              name: lang.name,
              romanization_maps: derived.maps,
              summary: derived.summary,
              phoneme_inventory: localCfg.phoneme_inventory,
              revision: phono.revision,
              legacy_writing: {
                present: legacyWriting.present,
                needs_review: legacyWriting.needs_review,
              },
            };
          },
        );

        return jsonResourceResponse(uri, payload);
      }),
  );

  // 6. conlang://{family_id}/{language_id}/grammar
  server.registerResource(
    "language_grammar",
    new ResourceTemplate("conlang://{family_id}/{language_id}/grammar", {
      list: async () => ({
        resources: listAllowedFamilyLanguages(config).map(
          ({ family, language }) => ({
            uri: `conlang://${encodeURIComponent(family.family_id)}/${encodeURIComponent(language.language_id)}/grammar`,
            name: `${language.name} (${family.name}) — Grammar`,
            description: `Typology, syntax, morphology, derivation, and grammar manual for "${language.name}"`,
            mimeType: "application/json",
          }),
        ),
      }),
      complete: {
        family_id: completeFamilyIds,
        language_id: completeLanguageIds,
      },
    }),
    {
      title: "Language Grammar Configuration",
      description:
        "Returns grammar.json configuration (typology, syntax, parts_of_speech, inflection, derivation, grammar_manual) and revision.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      await runResourceRead(async () => {
        const familyId = extractTemplateVar(variables, "family_id");
        const languageId = extractTemplateVar(variables, "language_id");
        const family = resolveFamily(config, familyId);

        const payload = await withConsistentProjectRead(
          family.project_dir,
          config.mode,
          "resource:language_grammar",
          () => {
            const ws = readWorkspaceUnlocked(family.conlang_file_path);
            const resolved = resolveLanguage(family, languageId, {
              workspace: ws.config,
              revision: ws.revision,
            });
            const grammar = readGrammarUnlocked(
              family.project_dir,
              resolved.language,
            );
            return {
              family_id: family.family_id,
              language_id: resolved.language.language_id,
              name: resolved.language.name,
              config: grammar.config,
              revision: grammar.revision,
            };
          },
        );

        return jsonResourceResponse(uri, payload);
      }),
  );

  // 7. conlang://{family_id}/{language_id}/sca
  server.registerResource(
    "language_sca",
    new ResourceTemplate("conlang://{family_id}/{language_id}/sca", {
      list: async () => ({
        resources: listAllowedFamilyLanguages(config).map(
          ({ family, language }) => ({
            uri: `conlang://${encodeURIComponent(family.family_id)}/${encodeURIComponent(language.language_id)}/sca`,
            name: `${language.name} (${family.name}) — Sound Changes (SCA)`,
            description: `Historical sound change rule sets for "${language.name}"`,
            mimeType: "application/json",
          }),
        ),
      }),
      complete: {
        family_id: completeFamilyIds,
        language_id: completeLanguageIds,
      },
    }),
    {
      title: "Language Sound Change Applier (SCA) Rules",
      description:
        "Returns sca_rules.json rule sets (ordered phonological & feature rules) and revision.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      await runResourceRead(async () => {
        const familyId = extractTemplateVar(variables, "family_id");
        const languageId = extractTemplateVar(variables, "language_id");
        const family = resolveFamily(config, familyId);

        const payload = await withConsistentProjectRead(
          family.project_dir,
          config.mode,
          "resource:language_sca",
          () => {
            const ws = readWorkspaceUnlocked(family.conlang_file_path);
            const resolved = resolveLanguage(family, languageId, {
              workspace: ws.config,
              revision: ws.revision,
            });
            const sca = readScaUnlocked(family.project_dir, resolved.language);
            return {
              family_id: family.family_id,
              language_id: resolved.language.language_id,
              name: resolved.language.name,
              config: sca.config,
              revision: sca.revision,
            };
          },
        );

        return jsonResourceResponse(uri, payload);
      }),
  );

  // 8. conlang://{family_id}/{language_id}/font
  server.registerResource(
    "language_font",
    new ResourceTemplate("conlang://{family_id}/{language_id}/font", {
      list: async () => ({
        resources: listAllowedFamilyLanguages(config).map(
          ({ family, language }) => ({
            uri: `conlang://${encodeURIComponent(family.family_id)}/${encodeURIComponent(language.language_id)}/font`,
            name: `${language.name} (${family.name}) — Font Inspection`,
            description: `Resolved font metadata, OpenType features, and cmap summary for "${language.name}"`,
            mimeType: "application/json",
          }),
        ),
      }),
      complete: {
        family_id: completeFamilyIds,
        language_id: completeLanguageIds,
      },
    }),
    {
      title: "Language Resolved Font Inspection",
      description:
        "Returns resolved font status (own, inherited, or none), HarfBuzz face metadata, GSUB/GPOS feature tags, Unicode block distribution, cmap ranges, and revisions.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      await runResourceRead(async () => {
        const familyId = extractTemplateVar(variables, "family_id");
        const languageId = extractTemplateVar(variables, "language_id");
        const family = resolveFamily(config, familyId);

        const snap = await withConsistentProjectRead(
          family.project_dir,
          config.mode,
          "resource:language_font",
          () => {
            const ws = readWorkspaceUnlocked(family.conlang_file_path);
            const resolvedLang = resolveLanguage(family, languageId, {
              workspace: ws.config,
              revision: ws.revision,
            });
            const langDir = assertSafeRelativeLanguagePath(
              family.project_dir,
              resolvedLang.language.path,
            );
            const ownFile = findOwnFontFile(langDir);
            const ownRev = ownFile
              ? computeFileRevision(ownFile)
              : MISSING_REVISION;
            const resolvedFont = resolveFontFileUnlocked(
              family.project_dir,
              ws.config.languages,
              resolvedLang.language.language_id,
            );
            const ancestorChain = buildAncestorChain(
              ws.config.languages,
              resolvedLang.language.language_id,
            );
            return {
              language: resolvedLang.language,
              ownFile: ownFile ? path.basename(ownFile) : null,
              ownRev,
              resolvedFont,
              ancestorChain,
            };
          },
        );

        if (!snap.resolvedFont) {
          return jsonResourceResponse(uri, {
            family_id: family.family_id,
            language_id: snap.language.language_id,
            name: snap.language.name,
            present: false,
            status: "none",
            has_own: snap.ownFile !== null,
            inherited: false,
            revision: snap.ownRev,
            resolved_revision: null,
            ancestor_chain: snap.ancestorChain,
          });
        }

        const handle = await loadFontFromBytes(
          snap.resolvedFont.bytes,
          snap.resolvedFont.file_name,
        );

        const blockCounts: Record<string, number> = {};
        for (const cp of handle.unicodeList) {
          const blk = unicodeBlockId(cp);
          blockCounts[blk] = (blockCounts[blk] ?? 0) + 1;
        }

        return jsonResourceResponse(uri, {
          family_id: family.family_id,
          language_id: snap.language.language_id,
          name: snap.language.name,
          present: true,
          status: snap.resolvedFont.inherited ? "inherited" : "own",
          has_own: snap.resolvedFont.has_own,
          inherited: snap.resolvedFont.inherited,
          owner_language_id: snap.resolvedFont.owner_language_id,
          owner_name: snap.resolvedFont.owner_name,
          file_name: snap.resolvedFont.file_name,
          revision: snap.ownRev,
          resolved_revision: snap.resolvedFont.revision,
          sha256: handle.sha256,
          family_name: handle.familyName,
          subfamily_name: handle.subfamilyName,
          version: handle.version,
          upem: handle.upem,
          glyph_count: handle.glyphCount,
          glyph_names_reliable: handle.hasGlyphNames,
          codepoint_count: handle.unicodeList.length,
          substitution_features: handle.gsubFeatures,
          positioning_features: handle.gposFeatures,
          gsub_scripts: handle.gsubScripts,
          gpos_scripts: handle.gposScripts,
          unicode_blocks: blockCounts,
          cmap_ranges: handle.cmapRanges,
        });
      }),
  );

  // 9. conlang://{family_id}/{language_id}/lexicon/{entry_id}
  server.registerResource(
    "lexicon_entry",
    new ResourceTemplate(
      "conlang://{family_id}/{language_id}/lexicon/{entry_id}",
      {
        list: undefined,
        complete: {
          family_id: completeFamilyIds,
          language_id: completeLanguageIds,
          entry_id: (prefix, context) => {
            const q = prefix.toLowerCase();
            try {
              const fam = resolveFamily(config, context?.arguments?.family_id);
              const ws = readWorkspaceUnlocked(fam.conlang_file_path);
              const langArg = context?.arguments?.language_id ?? "";
              const resolved = resolveLanguage(fam, langArg, {
                workspace: ws.config,
                revision: ws.revision,
              });
              const lex = readLexiconUnlocked(
                fam.project_dir,
                resolved.language,
              );
              return lex.words
                .map((w) => w.entry_id)
                .filter((id) => id.toLowerCase().startsWith(q))
                .slice(0, 50);
            } catch {
              return [];
            }
          },
        },
      },
    ),
    {
      title: "Single Lexicon Word Entry",
      description:
        "Returns a single lexicon WordEntry by (family_id, language_id, entry_id) along with the lexicon revision.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      await runResourceRead(async () => {
        const familyId = extractTemplateVar(variables, "family_id");
        const languageId = extractTemplateVar(variables, "language_id");
        const entryId = extractTemplateVar(variables, "entry_id");
        const family = resolveFamily(config, familyId);

        const payload = await withConsistentProjectRead(
          family.project_dir,
          config.mode,
          "resource:lexicon_entry",
          () => {
            const ws = readWorkspaceUnlocked(family.conlang_file_path);
            const resolved = resolveLanguage(family, languageId, {
              workspace: ws.config,
              revision: ws.revision,
            });
            const lex = readLexiconUnlocked(
              family.project_dir,
              resolved.language,
            );
            const entry = lex.words.find((w) => w.entry_id === entryId);
            if (!entry) {
              throw new McpError(
                "NOT_FOUND",
                `Lexicon entry "${entryId}" not found in language "${resolved.language.name}" (${resolved.language.language_id}).`,
              );
            }
            return {
              family_id: family.family_id,
              language_id: resolved.language.language_id,
              entry_id: entry.entry_id,
              entry,
              revision: lex.revision,
            };
          },
        );

        return jsonResourceResponse(uri, payload);
      }),
  );

  // 10. conlang://{family_id}/{language_id}/corpus/{corpus_id}
  server.registerResource(
    "corpus_text",
    new ResourceTemplate(
      "conlang://{family_id}/{language_id}/corpus/{corpus_id}",
      {
        list: async () => {
          const resources: {
            uri: string;
            name: string;
            description: string;
            mimeType: string;
          }[] = [];
          for (const { family, language } of listAllowedFamilyLanguages(
            config,
          )) {
            try {
              const idx = readCorpusIndexUnlocked(family.project_dir, language);
              for (const item of idx.entries) {
                resources.push({
                  uri: `conlang://${encodeURIComponent(family.family_id)}/${encodeURIComponent(language.language_id)}/corpus/${encodeURIComponent(item.corpus_id)}`,
                  name: `${item.title || item.corpus_id} — ${language.name} (${family.name})`,
                  description: `Corpus text "${item.title || item.corpus_id}" in "${language.name}"`,
                  mimeType: "application/json",
                });
              }
            } catch (err) {
              console.warn(
                `[conlang-mcp] Skipping unreadable corpus index in "${language.language_id}":`,
                err,
              );
            }
          }
          return { resources };
        },
        complete: {
          family_id: completeFamilyIds,
          language_id: completeLanguageIds,
          corpus_id: (prefix, context) => {
            const q = prefix.toLowerCase();
            try {
              const fam = resolveFamily(config, context?.arguments?.family_id);
              const ws = readWorkspaceUnlocked(fam.conlang_file_path);
              const langArg = context?.arguments?.language_id ?? "";
              const resolved = resolveLanguage(fam, langArg, {
                workspace: ws.config,
                revision: ws.revision,
              });
              const idx = readCorpusIndexUnlocked(
                fam.project_dir,
                resolved.language,
              );
              return idx.entries
                .map((e) => e.corpus_id)
                .filter((id) => id.toLowerCase().startsWith(q))
                .slice(0, 50);
            } catch {
              return [];
            }
          },
        },
      },
    ),
    {
      title: "Single Corpus Text & Interlinear Gloss",
      description:
        "Returns a single corpus text with full interlinear glossed lines, file revision, and corpus_index revision.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      await runResourceRead(async () => {
        const familyId = extractTemplateVar(variables, "family_id");
        const languageId = extractTemplateVar(variables, "language_id");
        const corpusId = extractTemplateVar(variables, "corpus_id");
        const family = resolveFamily(config, familyId);

        const payload = await withConsistentProjectRead(
          family.project_dir,
          config.mode,
          "resource:corpus_text",
          () => {
            const ws = readWorkspaceUnlocked(family.conlang_file_path);
            const resolved = resolveLanguage(family, languageId, {
              workspace: ws.config,
              revision: ws.revision,
            });
            const loaded = readCorpusTextUnlocked(
              family.project_dir,
              resolved.language,
              corpusId,
            );
            return {
              family_id: family.family_id,
              language_id: resolved.language.language_id,
              corpus_id: loaded.corpus.corpus_id,
              corpus: loaded.corpus,
              revision: loaded.revision,
              index_revision: loaded.index_revision,
            };
          },
        );

        return jsonResourceResponse(uri, payload);
      }),
  );
}
