import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { generateAff, generateDic } from "../../src/core/engines/exportDic";
import { generateLLMPrompt } from "../../src/core/engines/llmPrompt";
import type {
  CorpusIndexEntry,
  CorpusText,
  LanguageEntry,
  WordEntry,
  WorkspaceConfig,
} from "../../src/types";
import {
  assertDestructiveAllowed,
  assertWriteAllowed,
  type McpConfig,
} from "../config";
import { McpError } from "../errors";
import { loadFontFromBytes, MAX_FONT_BYTES } from "../font/loader";
import {
  assertPathAllowed,
  assertSafeRelativeLanguagePath,
} from "../registry/addressing";
import { atomicWriteFileSync } from "../storage/atomicWrite";
import {
  defaultGrammarConfig,
  defaultPhonologyConfig,
  defaultScaConfig,
  findOwnFontFile,
  normalizeWordEntryFromRaw,
  readCorpusIndexUnlocked,
  readCorpusTextUnlocked,
  readGrammarUnlocked,
  readLexiconUnlocked,
  readPhonologyUnlocked,
  readScaUnlocked,
  readWorkspaceUnlocked,
  withConsistentProjectRead,
} from "../storage/read";
import {
  canonicalizeConlangPath,
  computeFamilyId,
  sha256FullHex,
} from "../storage/revision";
import { planProjectSnapshot } from "../storage/snapshot";
import {
  executeProjectTransaction,
  type PlannedMutation,
  type RevisionExpectation,
} from "../storage/transaction";
import { registerDefinedTool } from "../toolRegistry";
import {
  bucketFilename,
  commonWriteInputFields,
  currentLexiconRevUnlocked,
  familyInputFields,
  languageInputFields,
  normalizeRelPathPosix,
  readLexiconBucketsPreserveUnknownUnlocked,
  resolveFamilyFromArgs,
  resolveLanguageUnlocked,
  serializeBucketWords,
  validateWordStrictOrThrow,
} from "./_helpers";

interface FontAssetWire {
  file_name: string;
  bytes_base64: string;
}

interface LanguageBundleWire {
  font?: FontAssetWire | null;
  phonology: Record<string, unknown>;
  grammar: Record<string, unknown>;
  sca: Record<string, unknown>;
  words: WordEntry[];
  corpus_index: CorpusIndexEntry[];
  corpus_texts: Record<string, CorpusText>;
  [extraKey: string]: unknown;
}

interface WorkspaceBundleWire {
  bundle_version: number;
  conlang_maker_version: string;
  workspace: WorkspaceConfig;
  languages: Record<string, LanguageBundleWire>;
  [extraKey: string]: unknown;
}

const INLINE_TEXT_THRESHOLD_BYTES = 65_536;

function escapeCsvCell(value: string): string {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function sanitizeExportBasename(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "conlang";
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function readRawJsonOrDefault(
  absPath: string,
  fallbackDefault: () => unknown,
): Record<string, unknown> {
  if (!fs.existsSync(absPath)) {
    return fallbackDefault() as Record<string, unknown>;
  }
  const raw = JSON.parse(fs.readFileSync(absPath, "utf-8")) as unknown;
  if (!isPlainObject(raw)) {
    throw new McpError("VALIDATION", `Expected JSON object in ${absPath}`);
  }
  if (Object.keys(raw).length === 0) {
    return fallbackDefault() as Record<string, unknown>;
  }
  return raw;
}

function normalizeBundledConfigObject(
  raw: unknown,
  label: string,
  languageId: string,
  fallbackDefault: (langId: string) => unknown,
): Record<string, unknown> {
  if (raw === undefined || raw === null) {
    return fallbackDefault(languageId) as Record<string, unknown>;
  }
  if (!isPlainObject(raw)) {
    throw new McpError(
      "VALIDATION",
      `Invalid ${label} configuration for language "${languageId}": expected JSON object.`,
    );
  }
  if (Object.keys(raw).length === 0) {
    return fallbackDefault(languageId) as Record<string, unknown>;
  }
  const defaults = fallbackDefault(languageId) as Record<string, unknown>;
  return {
    ...defaults,
    ...raw,
    language_id:
      typeof raw.language_id === "string" && raw.language_id.length > 0
        ? raw.language_id
        : languageId,
  };
}

function assertAcyclicParentGraph(languages: readonly LanguageEntry[]): void {
  const byId = new Map<string, LanguageEntry>();
  for (const lang of languages) {
    byId.set(lang.language_id, lang);
  }
  for (const lang of languages) {
    if (lang.parent_id !== null && lang.parent_id !== undefined) {
      if (!byId.has(lang.parent_id)) {
        throw new McpError(
          "VALIDATION",
          `Language "${lang.language_id}" references missing parent_id "${lang.parent_id}".`,
        );
      }
    }
  }
  for (const lang of languages) {
    const visited = new Set<string>();
    let cur: string | null | undefined = lang.language_id;
    while (cur) {
      if (visited.has(cur)) {
        throw new McpError(
          "VALIDATION",
          `Cycle detected in workspace parent_id graph involving "${cur}".`,
        );
      }
      visited.add(cur);
      cur = byId.get(cur)?.parent_id ?? null;
    }
  }
}

function isSafeCorpusId(id: string): boolean {
  return (
    id.length > 0 &&
    !id.includes("/") &&
    !id.includes("\\") &&
    id !== "." &&
    id !== ".."
  );
}

function filterMarkdownSections(
  markdown: string,
  requestedSections?: readonly string[],
): string {
  if (!requestedSections || requestedSections.length === 0) {
    return markdown;
  }
  const needles = requestedSections
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (needles.length === 0) {
    return markdown;
  }

  const lines = markdown.split("\n");
  const out: string[] = [];
  let inTopHeader = true;
  let keepCurrentH2 = true;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      inTopHeader = false;
      const heading = line.slice(3).trim().toLowerCase();
      keepCurrentH2 = needles.some(
        (n) =>
          heading.includes(n) ||
          (n === "phonology" &&
            (heading.includes("phoneme") ||
              heading.includes("tone") ||
              heading.includes("syllable") ||
              heading.includes("vowel") ||
              heading.includes("allophony"))) ||
          (n === "romanization" && heading.includes("romanization")) ||
          (n === "grammar" &&
            (heading.includes("typolog") ||
              heading.includes("syntax") ||
              heading.includes("parts of speech") ||
              heading.includes("inflection") ||
              heading.includes("affix") ||
              heading.includes("conjugation") ||
              heading.includes("derivation") ||
              heading.includes("irregular") ||
              heading.includes("manual"))) ||
          (n === "sca" && heading.includes("sound change")) ||
          (n === "lexicon" && heading.includes("lexicon")) ||
          (n === "corpus" && heading.includes("corpus")) ||
          (n === "family" && heading.includes("family")),
      );
    }
    if (inTopHeader || keepCurrentH2) {
      out.push(line);
    }
  }
  return out.join("\n").trimEnd() + "\n";
}

function writeExportFileSafely(
  config: McpConfig,
  toolName: string,
  rawOutputPath: string,
  content: Buffer | string,
  overwrite: boolean,
): string {
  assertWriteAllowed(config, toolName);
  const abs = assertPathAllowed(rawOutputPath, config);
  if (!overwrite && fs.existsSync(abs)) {
    throw new McpError(
      "CONFLICT",
      `Output file already exists: ${abs}`,
      "Pass overwrite: true or choose a new output_path.",
    );
  }
  atomicWriteFileSync(abs, content);
  return abs;
}

export function registerExportImportTools(
  server: McpServer,
  config: McpConfig,
): void {
  // 1. export_llm_brief
  registerDefinedTool(server, config, {
    name: "export_llm_brief",
    title: "Export Language Reference Markdown Brief",
    description:
      "Generates an LLM-friendly Markdown reference brief for a language (phonology, romanization, grammar, SCA, lexicon, and corpus samples) via generateLLMPrompt, optionally filtering sections or writing atomically to output_path.",
    toolsets: ["core", "compute", "admin"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      max_words: z
        .number()
        .int()
        .min(0)
        .max(2000)
        .optional()
        .default(200)
        .describe("Maximum lexicon entries to embed in the Markdown brief"),
      include_sca: z.boolean().optional().default(true),
      include_corpus: z.boolean().optional().default(true),
      include_family: z.boolean().optional().default(true),
      sections: z
        .array(z.string())
        .optional()
        .describe(
          "Optional section filter keywords (e.g. ['phonology', 'romanization', 'grammar', 'lexicon'])",
        ),
      output_path: z
        .string()
        .optional()
        .describe("Optional file path to write Markdown output (requires write mode)"),
      overwrite: z
        .boolean()
        .optional()
        .default(false)
        .describe("Allow overwriting output_path if it already exists"),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      const snapshot = await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "export_llm_brief",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const phono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            resolved.language,
          );
          const grammar = readGrammarUnlocked(
            family.project_dir,
            resolved.language,
          );
          const lexicon = readLexiconUnlocked(
            family.project_dir,
            resolved.language,
          );
          const sca = args.include_sca
            ? readScaUnlocked(family.project_dir, resolved.language)
            : undefined;
          const corpusIdx = args.include_corpus
            ? readCorpusIndexUnlocked(family.project_dir, resolved.language)
            : undefined;
          const corpusTexts: CorpusText[] = [];
          if (corpusIdx) {
            for (const item of corpusIdx.entries.slice(0, 5)) {
              try {
                const ct = readCorpusTextUnlocked(
                  family.project_dir,
                  resolved.language,
                  item.corpus_id,
                );
                corpusTexts.push(ct.corpus);
              } catch (err) {
                console.warn(
                  `[conlang-mcp] Skipping unreadable corpus "${item.corpus_id}" in export_llm_brief:`,
                  err,
                );
              }
            }
          }

          const activeWords = lexicon.words.filter(
            (w) => !w.evolution?.is_deprecated,
          );
          const fullMarkdown = generateLLMPrompt({
            langName: resolved.language.name,
            phonoConfig: phono.effective_config ?? phono.config,
            grammarConfig: grammar.config,
            words: activeWords,
            scaConfig: sca?.config,
            corpusTexts: args.include_corpus ? corpusTexts : undefined,
            languages: args.include_family
              ? resolved.workspace.languages
              : undefined,
            maxWords: args.max_words,
          });
          const markdown = filterMarkdownSections(fullMarkdown, args.sections);

          return {
            resolved,
            markdown,
            revisions: {
              workspace: resolved.workspace_revision,
              phonology: phono.effective_revision,
              grammar: grammar.revision,
              lexicon: lexicon.revision,
              ...(sca ? { sca: sca.revision } : {}),
              ...(corpusIdx ? { corpus_index: corpusIdx.revision } : {}),
            },
          };
        },
      );

      let writtenPath: string | null = null;
      if (args.output_path) {
        writtenPath = writeExportFileSafely(
          config,
          "export_llm_brief",
          args.output_path,
          snapshot.markdown,
          args.overwrite,
        );
      }

      const byteLength = Buffer.byteLength(snapshot.markdown, "utf-8");
      const includeInline =
        !writtenPath || byteLength <= INLINE_TEXT_THRESHOLD_BYTES;

      return {
        family_id: family.family_id,
        language_id: snapshot.resolved.language.language_id,
        language_name: snapshot.resolved.language.name,
        char_count: Array.from(snapshot.markdown).length,
        byte_length: byteLength,
        output_path: writtenPath,
        revisions: snapshot.revisions,
        ...(includeInline ? { markdown: snapshot.markdown } : {}),
      };
    },
  });

  // 2. export_workspace_bundle
  registerDefinedTool(server, config, {
    name: "export_workspace_bundle",
    title: "Export Full Workspace Bundle (.conlangbundle.json v2)",
    description:
      "Exports the entire language family workspace (workspace topology, per-language phonology/grammar/SCA preserving unknown fields, lexicon entries, corpora, and base64 OpenType font assets) in v2 bundle format compatible with GUI import_workspace_bundle.",
    toolsets: ["admin", "core"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      output_path: z
        .string()
        .optional()
        .describe("Optional destination path for the .conlangbundle.json file (requires write mode)"),
      overwrite: z
        .boolean()
        .optional()
        .default(false)
        .describe("Allow overwriting output_path if it already exists"),
      include_inline_bundle: z
        .boolean()
        .optional()
        .describe("Force including or omitting the parsed bundle object in the tool response"),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      const result = await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "export_workspace_bundle",
        async () => {
          const ws = readWorkspaceUnlocked(family.conlang_file_path);
          const languages: Record<string, LanguageBundleWire> = {};
          let totalWords = 0;
          let totalCorpora = 0;
          let fontsBundled = 0;

          for (const lang of ws.config.languages) {
            const langDir = assertSafeRelativeLanguagePath(
              family.project_dir,
              lang.path,
            );

            let fontAsset: FontAssetWire | undefined;
            const ownFontPath = findOwnFontFile(langDir);
            if (ownFontPath) {
              const fontBytes = fs.readFileSync(ownFontPath);
              const fileName = path.basename(ownFontPath);
              await loadFontFromBytes(fontBytes, fileName);
              fontAsset = {
                file_name: fileName,
                bytes_base64: fontBytes.toString("base64"),
              };
              fontsBundled += 1;
            }

            const phonology = readRawJsonOrDefault(
              path.join(langDir, "phonology.json"),
              () => defaultPhonologyConfig(lang.language_id),
            );
            const grammar = readRawJsonOrDefault(
              path.join(langDir, "grammar.json"),
              () => defaultGrammarConfig(lang.language_id),
            );
            const sca = readRawJsonOrDefault(
              path.join(langDir, "sca_rules.json"),
              () => defaultScaConfig(lang.language_id),
            );

            const buckets = readLexiconBucketsPreserveUnknownUnlocked(
              family.project_dir,
              lang,
            );
            const words: WordEntry[] = [];
            for (const bname of Array.from(buckets.keys()).sort()) {
              const bwords = buckets.get(bname) ?? [];
              words.push(...bwords);
            }
            totalWords += words.length;

            const corpusDir = path.join(langDir, "corpus");
            let corpusIndex: CorpusIndexEntry[] = [];
            const corpusTexts: Record<string, CorpusText> = {};
            const indexPath = path.join(corpusDir, "corpus_index.json");
            if (fs.existsSync(indexPath)) {
              const parsedIdx = JSON.parse(
                fs.readFileSync(indexPath, "utf-8"),
              ) as unknown;
              if (!Array.isArray(parsedIdx)) {
                throw new McpError(
                  "VALIDATION",
                  `Invalid corpus_index.json in ${lang.path}`,
                );
              }
              corpusIndex = parsedIdx as CorpusIndexEntry[];
              for (const idxEntry of corpusIndex) {
                if (!isSafeCorpusId(idxEntry.corpus_id)) {
                  throw new McpError(
                    "VALIDATION",
                    `Invalid corpus_id "${idxEntry.corpus_id}" in ${lang.path}`,
                  );
                }
                const textPath = path.join(
                  corpusDir,
                  `${idxEntry.corpus_id}.json`,
                );
                if (!fs.existsSync(textPath)) {
                  throw new McpError(
                    "NOT_FOUND",
                    `Missing corpus file for indexed corpus_id "${idxEntry.corpus_id}" in ${lang.path}`,
                  );
                }
                corpusTexts[idxEntry.corpus_id] = JSON.parse(
                  fs.readFileSync(textPath, "utf-8"),
                ) as CorpusText;
              }
              totalCorpora += corpusIndex.length;
            }

            languages[lang.language_id] = {
              ...(fontAsset ? { font: fontAsset } : { font: null }),
              phonology,
              grammar,
              sca,
              words,
              corpus_index: corpusIndex,
              corpus_texts: corpusTexts,
            };
          }

          const bundle: WorkspaceBundleWire = {
            bundle_version: 2,
            conlang_maker_version: config.version,
            workspace: ws.config,
            languages,
          };
          const jsonText = JSON.stringify(bundle, null, 2);
          return {
            wsRevision: ws.revision,
            bundle,
            jsonText,
            languageCount: ws.config.languages.length,
            totalWords,
            totalCorpora,
            fontsBundled,
          };
        },
      );

      let writtenPath: string | null = null;
      if (args.output_path) {
        writtenPath = writeExportFileSafely(
          config,
          "export_workspace_bundle",
          args.output_path,
          result.jsonText,
          args.overwrite,
        );
      }

      const byteLength = Buffer.byteLength(result.jsonText, "utf-8");
      const sha256 = sha256FullHex(Buffer.from(result.jsonText, "utf-8"));
      const includeInline =
        args.include_inline_bundle ??
        (!writtenPath || byteLength <= INLINE_TEXT_THRESHOLD_BYTES);

      return {
        family_id: family.family_id,
        name: family.name,
        workspace_revision: result.wsRevision,
        bundle_version: 2,
        conlang_maker_version: config.version,
        language_count: result.languageCount,
        total_words: result.totalWords,
        total_corpora: result.totalCorpora,
        fonts_bundled: result.fontsBundled,
        byte_length: byteLength,
        sha256,
        output_path: writtenPath,
        ...(includeInline ? { bundle: result.bundle } : {}),
      };
    },
  });

  // 3. export_csv
  registerDefinedTool(server, config, {
    name: "export_csv",
    title: "Export Language Lexicon as RFC-4180 CSV",
    description:
      "Exports a language's lexicon to RFC-4180 CSV (entry_id,romanized,ipa,pos_id,gloss,definitions,tags,origin_type), optionally writing to output_path.",
    toolsets: ["core", "admin"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      include_deprecated: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include deprecated word entries in CSV export"),
      output_path: z
        .string()
        .optional()
        .describe("Optional destination .csv path (requires write mode)"),
      overwrite: z
        .boolean()
        .optional()
        .default(false)
        .describe("Allow overwriting output_path if it already exists"),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      const data = await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "export_csv",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const lex = readLexiconUnlocked(
            family.project_dir,
            resolved.language,
          );
          const filtered = args.include_deprecated
            ? lex.words
            : lex.words.filter((w) => !w.evolution?.is_deprecated);

          const header =
            "entry_id,romanized,ipa,pos_id,gloss,definitions,tags,origin_type";
          const rows = filtered.map((w) => {
            const posIds = w.senses
              .map((s) => s.pos_id)
              .filter(Boolean)
              .join("/");
            const glosses = w.senses
              .map((s) => s.gloss)
              .filter(Boolean)
              .join("; ");
            const definitions = w.senses
              .flatMap((s) => s.definitions)
              .filter(Boolean)
              .join("; ");
            const tags = w.metadata.tags.join(", ");
            return [
              w.entry_id,
              w.con_word_romanized,
              w.phonetic_ipa,
              posIds,
              glosses,
              definitions,
              tags,
              w.etymology.origin_type,
            ]
              .map((cell) => escapeCsvCell(cell ?? ""))
              .join(",");
          });

          const csv = [header, ...rows].join("\n") + "\n";
          return {
            resolved,
            lexRevision: lex.revision,
            entryCount: filtered.length,
            csv,
          };
        },
      );

      let writtenPath: string | null = null;
      if (args.output_path) {
        writtenPath = writeExportFileSafely(
          config,
          "export_csv",
          args.output_path,
          data.csv,
          args.overwrite,
        );
      }

      const byteLength = Buffer.byteLength(data.csv, "utf-8");
      const includeInline =
        !writtenPath || byteLength <= INLINE_TEXT_THRESHOLD_BYTES;

      return {
        family_id: family.family_id,
        language_id: data.resolved.language.language_id,
        language_name: data.resolved.language.name,
        entry_count: data.entryCount,
        byte_length: byteLength,
        lexicon_revision: data.lexRevision,
        output_path: writtenPath,
        ...(includeInline ? { csv: data.csv } : {}),
      };
    },
  });

  // 4. export_dic
  registerDefinedTool(server, config, {
    name: "export_dic",
    title: "Export Hunspell .dic / .aff Dictionary",
    description:
      "Generates Hunspell spellcheck dictionary files (.aff and .dic) for a language including base forms and optional inflected paradigm forms.",
    toolsets: ["compute", "admin"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      include_inflections: z
        .boolean()
        .optional()
        .default(true)
        .describe("Expand inflected paradigm forms using active grammar rules"),
      include_deprecated: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include deprecated lexicon entries"),
      output_dir: z
        .string()
        .optional()
        .describe("Optional directory to write <basename>.aff and <basename>.dic (requires write mode)"),
      basename: z
        .string()
        .optional()
        .describe("Base filename without extension when output_dir is specified"),
      overwrite: z
        .boolean()
        .optional()
        .default(false)
        .describe("Allow overwriting existing .aff / .dic files"),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      const data = await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "export_dic",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const lex = readLexiconUnlocked(
            family.project_dir,
            resolved.language,
          );
          const grammar = readGrammarUnlocked(
            family.project_dir,
            resolved.language,
          );
          const phono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            resolved.language,
          );

          const words = args.include_deprecated
            ? lex.words
            : lex.words.filter((w) => !w.evolution?.is_deprecated);

          const aff = generateAff(resolved.language.name);
          const dic = generateDic(
            words,
            args.include_inflections
              ? grammar.config.inflection_rules
              : undefined,
            args.include_inflections
              ? (phono.effective_config ?? phono.config)
              : undefined,
          );
          const firstNewline = dic.indexOf("\n");
          const formCount =
            firstNewline >= 0
              ? Number.parseInt(dic.slice(0, firstNewline), 10) || 0
              : Number.parseInt(dic, 10) || 0;

          return {
            resolved,
            aff,
            dic,
            formCount,
            revisions: {
              lexicon: lex.revision,
              grammar: grammar.revision,
              phonology: phono.effective_revision,
            },
          };
        },
      );

      let affPath: string | null = null;
      let dicPath: string | null = null;
      if (args.output_dir) {
        assertWriteAllowed(config, "export_dic");
        const outDirAbs = assertPathAllowed(args.output_dir, config);
        const base = sanitizeExportBasename(
          args.basename ?? data.resolved.language.language_id,
        );
        const targetAff = path.join(outDirAbs, `${base}.aff`);
        const targetDic = path.join(outDirAbs, `${base}.dic`);
        if (
          !args.overwrite &&
          (fs.existsSync(targetAff) || fs.existsSync(targetDic))
        ) {
          throw new McpError(
            "CONFLICT",
            `Hunspell output file already exists in ${outDirAbs} for basename "${base}".`,
            "Pass overwrite: true or choose another basename/output_dir.",
          );
        }
        atomicWriteFileSync(targetAff, data.aff);
        atomicWriteFileSync(targetDic, data.dic);
        affPath = targetAff;
        dicPath = targetDic;
      }

      const dicBytes = Buffer.byteLength(data.dic, "utf-8");
      const includeInline =
        !dicPath || dicBytes <= INLINE_TEXT_THRESHOLD_BYTES;

      return {
        family_id: family.family_id,
        language_id: data.resolved.language.language_id,
        language_name: data.resolved.language.name,
        form_count: data.formCount,
        aff_path: affPath,
        dic_path: dicPath,
        revisions: data.revisions,
        ...(includeInline ? { aff: data.aff, dic: data.dic } : {}),
      };
    },
  });

  // 5. import_workspace_bundle
  registerDefinedTool(server, config, {
    name: "import_workspace_bundle",
    title: "Import Workspace Bundle (Destructive)",
    description:
      "Atomically restores or imports a .conlangbundle.json (v1/v2) into a target workspace inside a crash-recoverable project transaction. Automatically captures a project-level snapshot before overwriting an existing workspace.",
    toolsets: ["admin"],
    access: "destructive",
    idempotent: true,
    inputSchema: {
      ...familyInputFields,
      ...commonWriteInputFields,
      confirm: z
        .boolean()
        .optional()
        .describe("Must be true to execute destructive bundle import (unless dry_run: true)"),
      bundle_path: z
        .string()
        .optional()
        .describe("Path to the source .conlangbundle.json file"),
      bundle_json: z
        .string()
        .optional()
        .describe("Inline JSON string of the workspace bundle"),
      bundle: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Inline parsed workspace bundle object"),
      target_conlang_path: z
        .string()
        .optional()
        .describe("Optional explicit destination .conlang file path (when importing into a new or specific path)"),
    },
    handler: async (args) => {
      assertDestructiveAllowed(
        config,
        "import_workspace_bundle",
        args.confirm,
        args.dry_run,
      );

      let conlangFilePath: string;
      let projectDir: string;
      let familyId: string;

      if (args.target_conlang_path) {
        if (!args.target_conlang_path.trim().endsWith(".conlang")) {
          throw new McpError(
            "VALIDATION",
            `target_conlang_path must end with ".conlang" (got "${args.target_conlang_path}").`,
          );
        }
        conlangFilePath = canonicalizeConlangPath(
          assertPathAllowed(args.target_conlang_path, config),
        );
        projectDir = path.dirname(conlangFilePath);
        familyId = computeFamilyId(conlangFilePath);
      } else {
        const family = resolveFamilyFromArgs(config, args);
        conlangFilePath = family.conlang_file_path;
        projectDir = family.project_dir;
        familyId = family.family_id;
      }

      let rawBundleText: string;
      let parsedBundleUnknown: unknown;

      if (args.bundle_path) {
        const srcAbs = assertPathAllowed(args.bundle_path, config);
        if (!fs.existsSync(srcAbs) || !fs.statSync(srcAbs).isFile()) {
          throw new McpError(
            "NOT_FOUND",
            `Bundle file not found: ${srcAbs}`,
          );
        }
        rawBundleText = fs.readFileSync(srcAbs, "utf-8");
        try {
          parsedBundleUnknown = JSON.parse(rawBundleText);
        } catch (err) {
          throw new McpError(
            "VALIDATION",
            `Invalid JSON in bundle file "${srcAbs}": ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else if (typeof args.bundle_json === "string") {
        rawBundleText = args.bundle_json;
        try {
          parsedBundleUnknown = JSON.parse(rawBundleText);
        } catch (err) {
          throw new McpError(
            "VALIDATION",
            `Invalid JSON in bundle_json: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else if (args.bundle) {
        parsedBundleUnknown = args.bundle;
        rawBundleText = JSON.stringify(args.bundle);
      } else {
        throw new McpError(
          "VALIDATION",
          "Provide one of bundle_path, bundle_json, or bundle.",
        );
      }

      if (!isPlainObject(parsedBundleUnknown)) {
        throw new McpError(
          "VALIDATION",
          "Workspace bundle root must be a JSON object.",
        );
      }

      const bundleVersion =
        typeof parsedBundleUnknown.bundle_version === "number"
          ? parsedBundleUnknown.bundle_version
          : 0;
      if (bundleVersion > 2) {
        throw new McpError(
          "VALIDATION",
          `Unsupported bundle_version ${bundleVersion} (maximum supported is 2).`,
        );
      }

      const rawWs = parsedBundleUnknown.workspace;
      if (!isPlainObject(rawWs) || !Array.isArray(rawWs.languages)) {
        throw new McpError(
          "VALIDATION",
          "Bundle is missing a valid workspace.languages array.",
        );
      }
      if (rawWs.languages.length === 0) {
        throw new McpError(
          "VALIDATION",
          "Bundle workspace.languages cannot be empty.",
        );
      }

      const wsLanguages: LanguageEntry[] = rawWs.languages.map(
        (item: unknown, idx: number) => {
          if (!isPlainObject(item)) {
            throw new McpError(
              "VALIDATION",
              `workspace.languages[${idx}] must be an object.`,
            );
          }
          const languageId =
            typeof item.language_id === "string" ? item.language_id.trim() : "";
          const name = typeof item.name === "string" ? item.name.trim() : "";
          const relPath = typeof item.path === "string" ? item.path.trim() : "";
          if (!languageId || !name || !relPath) {
            throw new McpError(
              "VALIDATION",
              `workspace.languages[${idx}] must define non-empty language_id, name, and path.`,
            );
          }
          return {
            ...(item as unknown as LanguageEntry),
            language_id: languageId,
            name,
            path: relPath,
            parent_id:
              typeof item.parent_id === "string" && item.parent_id.trim()
                ? item.parent_id.trim()
                : null,
          };
        },
      );

      assertAcyclicParentGraph(wsLanguages);

      const wsConfig: WorkspaceConfig = {
        ...(rawWs as unknown as WorkspaceConfig),
        workspace_version:
          typeof rawWs.workspace_version === "string" && rawWs.workspace_version
            ? rawWs.workspace_version
            : "3.0",
        languages: wsLanguages,
      };

      const rawLanguagesMap = parsedBundleUnknown.languages;
      if (!isPlainObject(rawLanguagesMap)) {
        throw new McpError(
          "VALIDATION",
          "Bundle is missing a valid languages map.",
        );
      }

      interface ValidatedLanguageImportPlan {
        languageId: string;
        relPath: string;
        writes: Array<{ relPath: string; content: Buffer | string }>;
        deletes: string[];
        keepBuckets: Set<string>;
        keepCorpora: Set<string>;
        wordCount: number;
        corpusCount: number;
        hasFont: boolean;
      }

      const seenIds = new Set<string>();
      const seenRelPaths = new Set<string>();
      const langPlans: ValidatedLanguageImportPlan[] = [];

      for (const lang of wsLanguages) {
        assertSafeRelativeLanguagePath(projectDir, lang.path);
        const langRel = normalizeRelPathPosix(lang.path);
        if (!langRel || langRel.startsWith("..") || langRel.includes("/../")) {
          throw new McpError(
            "VALIDATION",
            `Invalid relative language path "${lang.path}".`,
          );
        }
        if (seenIds.has(lang.language_id) || seenRelPaths.has(langRel)) {
          throw new McpError(
            "VALIDATION",
            `Bundle contains duplicate language_id "${lang.language_id}" or path "${langRel}".`,
          );
        }
        seenIds.add(lang.language_id);
        seenRelPaths.add(langRel);

        const langData = rawLanguagesMap[lang.language_id];
        if (!isPlainObject(langData)) {
          throw new McpError(
            "VALIDATION",
            `Bundle is missing language payload for "${lang.language_id}".`,
          );
        }

        const writes: Array<{ relPath: string; content: Buffer | string }> = [];
        const deletes: string[] = [];
        let hasFont = false;

        if (langData.font !== undefined && langData.font !== null) {
          if (!isPlainObject(langData.font)) {
            throw new McpError(
              "VALIDATION",
              `Invalid font descriptor for "${lang.language_id}".`,
            );
          }
          const fontFileName =
            typeof langData.font.file_name === "string"
              ? langData.font.file_name
              : "";
          const b64 =
            typeof langData.font.bytes_base64 === "string"
              ? langData.font.bytes_base64
              : "";
          if (fontFileName !== "font.otf" && fontFileName !== "font.ttf") {
            throw new McpError(
              "VALIDATION",
              `Invalid font asset filename "${fontFileName}" for "${lang.language_id}" (expected font.otf or font.ttf).`,
            );
          }
          if (b64.length > Math.ceil(MAX_FONT_BYTES / 3) * 4) {
            throw new McpError(
              "VALIDATION",
              `Bundled font for "${lang.language_id}" exceeds the 20 MB limit.`,
            );
          }
          if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64.replace(/\s+/g, ""))) {
            throw new McpError(
              "VALIDATION",
              `Invalid base64 encoding in bundled font for "${lang.language_id}".`,
            );
          }
          const fontBytes = Buffer.from(b64, "base64");
          await loadFontFromBytes(fontBytes, fontFileName);
          writes.push({
            relPath: `${langRel}/${fontFileName}`,
            content: fontBytes,
          });
          const otherFont =
            fontFileName === "font.otf" ? "font.ttf" : "font.otf";
          deletes.push(`${langRel}/${otherFont}`);
          hasFont = true;
        } else if (bundleVersion >= 2) {
          deletes.push(`${langRel}/font.otf`);
          deletes.push(`${langRel}/font.ttf`);
        }

        const phonoObj = normalizeBundledConfigObject(
          langData.phonology,
          "phonology",
          lang.language_id,
          defaultPhonologyConfig,
        );
        const grammarObj = normalizeBundledConfigObject(
          langData.grammar,
          "grammar",
          lang.language_id,
          defaultGrammarConfig,
        );
        const scaObj = normalizeBundledConfigObject(
          langData.sca,
          "SCA",
          lang.language_id,
          defaultScaConfig,
        );

        writes.push({
          relPath: `${langRel}/phonology.json`,
          content: JSON.stringify(phonoObj, null, 2),
        });
        writes.push({
          relPath: `${langRel}/grammar.json`,
          content: JSON.stringify(grammarObj, null, 2),
        });
        writes.push({
          relPath: `${langRel}/sca_rules.json`,
          content: JSON.stringify(scaObj, null, 2),
        });

        if (!Array.isArray(langData.words)) {
          throw new McpError(
            "VALIDATION",
            `languages["${lang.language_id}"].words must be an array.`,
          );
        }
        const bucketMap = new Map<string, WordEntry[]>();
        langData.words.forEach((rawWord: unknown, idx: number) => {
          if (!isPlainObject(rawWord)) {
            throw new McpError(
              "VALIDATION",
              `languages["${lang.language_id}"].words[${idx}] must be an object.`,
            );
          }
          const word = normalizeWordEntryFromRaw(rawWord, lang.language_id);
          validateWordStrictOrThrow(word, idx);
          const bname = bucketFilename(word.con_word_romanized);
          const list = bucketMap.get(bname) ?? [];
          list.push(word);
          bucketMap.set(bname, list);
        });

        const keepBuckets = new Set<string>(bucketMap.keys());
        for (const bname of Array.from(bucketMap.keys()).sort()) {
          const bwords = bucketMap.get(bname) ?? [];
          writes.push({
            relPath: `${langRel}/lexicon/${bname}`,
            content: serializeBucketWords(bwords),
          });
        }

        const rawCorpusIndex = Array.isArray(langData.corpus_index)
          ? langData.corpus_index
          : [];
        const rawCorpusTexts = isPlainObject(langData.corpus_texts)
          ? langData.corpus_texts
          : {};

        const seenCorpusIds = new Set<string>();
        const corpusIndex: CorpusIndexEntry[] = rawCorpusIndex.map(
          (rawEntry: unknown, cIdx: number) => {
            if (!isPlainObject(rawEntry)) {
              throw new McpError(
                "VALIDATION",
                `languages["${lang.language_id}"].corpus_index[${cIdx}] must be an object.`,
              );
            }
            const cid =
              typeof rawEntry.corpus_id === "string" ? rawEntry.corpus_id : "";
            if (!isSafeCorpusId(cid)) {
              throw new McpError(
                "VALIDATION",
                `Invalid corpus_id "${cid}" in languages["${lang.language_id}"].corpus_index[${cIdx}].`,
              );
            }
            if (seenCorpusIds.has(cid)) {
              throw new McpError(
                "VALIDATION",
                `Duplicate corpus_id "${cid}" in languages["${lang.language_id}"].corpus_index.`,
              );
            }
            if (!(cid in rawCorpusTexts)) {
              throw new McpError(
                "VALIDATION",
                `Missing corpus_texts["${cid}"] for indexed corpus in "${lang.language_id}".`,
              );
            }
            seenCorpusIds.add(cid);
            return rawEntry as unknown as CorpusIndexEntry;
          },
        );

        writes.push({
          relPath: `${langRel}/corpus/corpus_index.json`,
          content: JSON.stringify(corpusIndex, null, 2),
        });

        const keepCorpora = new Set<string>(["corpus_index.json"]);
        for (const [cid, rawText] of Object.entries(rawCorpusTexts)) {
          if (!isSafeCorpusId(cid) || !isPlainObject(rawText)) {
            throw new McpError(
              "VALIDATION",
              `Invalid corpus text entry "${cid}" in "${lang.language_id}".`,
            );
          }
          if (rawText.corpus_id !== cid) {
            throw new McpError(
              "VALIDATION",
              `Corpus ID mismatch: key "${cid}" !== corpus_id "${String(rawText.corpus_id)}".`,
            );
          }
          const fname = `${cid}.json`;
          keepCorpora.add(fname);
          writes.push({
            relPath: `${langRel}/corpus/${fname}`,
            content: JSON.stringify(rawText, null, 2),
          });
        }

        langPlans.push({
          languageId: lang.language_id,
          relPath: langRel,
          writes,
          deletes,
          keepBuckets,
          keepCorpora,
          wordCount: langData.words.length,
          corpusCount: corpusIndex.length,
          hasFont,
        });
      }

      const wsRel = normalizeRelPathPosix(
        path.relative(projectDir, conlangFilePath),
      );
      if (!wsRel || wsRel.includes("/") || wsRel.startsWith("..")) {
        throw new McpError(
          "VALIDATION",
          `Invalid workspace file location "${conlangFilePath}".`,
        );
      }
      const bundleSha256 = sha256FullHex(Buffer.from(rawBundleText, "utf-8"));
      const totalWords = langPlans.reduce((sum, p) => sum + p.wordCount, 0);
      const totalCorpora = langPlans.reduce((sum, p) => sum + p.corpusCount, 0);

      fs.mkdirSync(projectDir, { recursive: true });

      return await executeProjectTransaction({
        projectDir,
        toolName: "import_workspace_bundle",
        origin: "mcp",
        operationId: args.operation_id,
        dryRun: args.dry_run,
        requestPayloadForDigest: {
          conlang_file_path: conlangFilePath,
          bundle_sha256: bundleSha256,
        },
        planInsideLock: ({ operationId }) => {
          const expectations: RevisionExpectation[] = [
            {
              label: "workspace",
              targetPath: conlangFilePath,
              expectedRevision: args.expected_revision ?? "",
            },
          ];

          const mutations: PlannedMutation[] = [];
          let snapshotId: string | null = null;
          let removedOldDirs: string[] = [];

          if (
            fs.existsSync(conlangFilePath) &&
            fs.statSync(conlangFilePath).isFile()
          ) {
            const oldWs = readWorkspaceUnlocked(conlangFilePath);
            const snap = planProjectSnapshot({
              projectDir,
              conlangFilePath,
              workspace: oldWs.config,
              origin: "mcp",
              operationType: "import_bundle",
              description: "Before importing workspace bundle",
            });
            snapshotId = snap.snapshotId;
            mutations.push(...snap.mutations);

            const incomingRels = new Set(langPlans.map((p) => p.relPath));
            for (const oldLang of oldWs.config.languages) {
              const oldRel = normalizeRelPathPosix(oldLang.path);
              if (
                oldRel &&
                !incomingRels.has(oldRel) &&
                fs.existsSync(path.join(projectDir, oldRel))
              ) {
                mutations.push({
                  kind: "delete_path",
                  relPath: oldRel,
                });
                removedOldDirs.push(oldRel);
              }
            }
          }

          for (const lp of langPlans) {
            mutations.push({ kind: "create_dir", relPath: lp.relPath });
            mutations.push({
              kind: "create_dir",
              relPath: `${lp.relPath}/lexicon`,
            });
            mutations.push({
              kind: "create_dir",
              relPath: `${lp.relPath}/corpus`,
            });

            const lexAbs = path.join(projectDir, lp.relPath, "lexicon");
            if (fs.existsSync(lexAbs) && fs.statSync(lexAbs).isDirectory()) {
              for (const fname of fs.readdirSync(lexAbs)) {
                const fAbs = path.join(lexAbs, fname);
                if (
                  fs.statSync(fAbs).isFile() &&
                  fname.startsWith("lexicon_") &&
                  fname.endsWith(".ndjson") &&
                  !lp.keepBuckets.has(fname)
                ) {
                  mutations.push({
                    kind: "delete_path",
                    relPath: `${lp.relPath}/lexicon/${fname}`,
                  });
                }
              }
            }

            const corpAbs = path.join(projectDir, lp.relPath, "corpus");
            if (fs.existsSync(corpAbs) && fs.statSync(corpAbs).isDirectory()) {
              for (const fname of fs.readdirSync(corpAbs)) {
                const fAbs = path.join(corpAbs, fname);
                if (
                  fs.statSync(fAbs).isFile() &&
                  fname.endsWith(".json") &&
                  !lp.keepCorpora.has(fname)
                ) {
                  mutations.push({
                    kind: "delete_path",
                    relPath: `${lp.relPath}/corpus/${fname}`,
                  });
                }
              }
            }

            for (const delRel of lp.deletes) {
              if (fs.existsSync(path.join(projectDir, delRel))) {
                mutations.push({
                  kind: "delete_path",
                  relPath: delRel,
                });
              }
            }

            for (const w of lp.writes) {
              mutations.push({
                kind: "write_file",
                relPath: w.relPath,
                content: w.content,
              });
            }
          }

          mutations.push({
            kind: "write_file",
            relPath: wsRel,
            content: JSON.stringify(wsConfig, null, 2),
          });

          return {
            expectations,
            mutations,
            snapshotId,
            auditSummary: `Imported workspace bundle (${langPlans.length} language(s), ${totalWords} word(s))`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              family_id: familyId,
              conlang_file_path: conlangFilePath,
              base_revisions: baseRevisions,
              summary: {
                bundle_version: bundleVersion,
                imported_languages: langPlans.map((p) => p.languageId),
                removed_language_dirs: removedOldDirs,
                total_words: totalWords,
                total_corpora: totalCorpora,
              },
            }),
            buildResponse: (newRevisions, warnings) => {
              const lexiconRevs: Record<string, string> = {};
              for (const lang of wsLanguages) {
                lexiconRevs[lang.language_id] = currentLexiconRevUnlocked(
                  projectDir,
                  lang,
                );
              }
              return {
                operation_id: operationId,
                committed: true,
                changed: true,
                dry_run: false,
                family_id: familyId,
                conlang_file_path: conlangFilePath,
                snapshot_id: snapshotId,
                imported_languages: langPlans.map((p) => p.languageId),
                removed_language_dirs: removedOldDirs,
                total_words: totalWords,
                total_corpora: totalCorpora,
                revisions: {
                  ...newRevisions,
                  lexicon_by_language: lexiconRevs,
                },
                warnings,
              };
            },
          };
        },
      });
    },
  });
}
