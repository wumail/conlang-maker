import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { auditFontCoverage } from "../src/core/engines/coverage";
import { isValidWordEntry } from "../src/core/lexicon/utils";
import type {
  CorpusIndexEntry,
  CorpusText,
  GlyphAnnotation,
  LanguageEntry,
  PhonologyConfig,
  WordEntry,
  WorkspaceConfig,
} from "../src/types";
import { loadFontFromBytes } from "../mcp/font/loader";

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const SYNTHETIC_FIXTURE_DIR = path.join(REPO_ROOT, "tests/fixtures/workspace-basic");
const LIGA_FONT_PATH = path.join(REPO_ROOT, "tests/fixtures/fonts/liga-test.ttf");
const MCP_MAIN_PATH = path.join(REPO_ROOT, "mcp/main.ts");

interface DirectoryHashManifest {
  aggregateSha256: string;
  fileCount: number;
  totalBytes: number;
}

interface IndependentResolvedFont {
  ownerLanguageId: string;
  ownerName: string;
  inherited: boolean;
  fileName: string;
  filePath: string;
  sha256: string;
  cmap: ReadonlySet<number>;
}

interface IndependentLanguageTruth {
  language: LanguageEntry;
  fontStatus: "own" | "inherited" | "none";
  resolvedFont: IndependentResolvedFont | null;
  requiredCharsCount: number;
  missingCharsHex: string[];
  decomposedOnlyCount: number;
}

interface IndependentWorkspaceTruth {
  conlangPath: string;
  languages: LanguageEntry[];
  byLanguageId: Map<string, IndependentLanguageTruth>;
  distinctFontSha256s: Set<string>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Acceptance assertion failed: ${message}`);
  }
}

function sha256Hex(buf: Buffer | string): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function computeDirectoryHashManifest(rootDir: string): DirectoryHashManifest {
  const relFiles: string[] = [];

  function walk(currentDir: string): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const rel = path.relative(rootDir, fullPath).split(path.sep).join("/");
        relFiles.push(rel);
      }
    }
  }

  walk(rootDir);
  relFiles.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const aggregateHasher = crypto.createHash("sha256");
  let totalBytes = 0;

  for (const rel of relFiles) {
    const bytes = fs.readFileSync(path.join(rootDir, rel));
    totalBytes += bytes.length;
    const fileHash = sha256Hex(bytes);
    aggregateHasher.update(`${rel}:${bytes.length}:${fileHash}\n`);
  }

  return {
    aggregateSha256: aggregateHasher.digest("hex"),
    fileCount: relFiles.length,
    totalBytes,
  };
}

function findConlangFile(workspaceDir: string): string {
  const candidates = fs
    .readdirSync(workspaceDir)
    .filter((f) => f.endsWith(".conlang"))
    .sort();
  assert(
    candidates.length >= 1,
    `No .conlang file found inside ${workspaceDir}`,
  );
  return path.join(workspaceDir, candidates[0]);
}

function findOwnFontIndependent(langDir: string): string | null {
  for (const fileName of ["font.otf", "font.ttf"]) {
    const p = path.join(langDir, fileName);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      return p;
    }
  }
  return null;
}

function loadRawPhonologyWithInheritedAnnotations(
  workspaceDir: string,
  languages: readonly LanguageEntry[],
  lang: LanguageEntry,
): PhonologyConfig {
  const langDir = path.join(workspaceDir, lang.path);
  const phonoPath = path.join(langDir, "phonology.json");
  const fallback: PhonologyConfig = {
    language_id: lang.language_id,
    phoneme_inventory: { consonants: [], vowels: [] },
    romanization_maps: [],
    phonotactics: {
      macros: {},
      syllable_structure: "(C)V(C)",
      blacklist_patterns: [],
      vowel_harmony: { enabled: false, group_a: [], group_b: [] },
      tone_system: { enabled: false, tones: [] },
    },
    allophony_rules: [],
  };
  if (!fs.existsSync(phonoPath)) {
    return fallback;
  }

  const raw = JSON.parse(fs.readFileSync(phonoPath, "utf-8")) as Partial<PhonologyConfig>;
  let effectiveAnnotations: GlyphAnnotation[] | undefined =
    Array.isArray(raw.glyph_annotations) && raw.glyph_annotations.length > 0
      ? raw.glyph_annotations
      : undefined;

  if (!effectiveAnnotations) {
    const visited = new Set<string>([lang.language_id]);
    let parentId = lang.parent_id ?? null;
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const ancestor = languages.find((l) => l.language_id === parentId);
      if (!ancestor) break;
      const ancPhonoPath = path.join(workspaceDir, ancestor.path, "phonology.json");
      if (fs.existsSync(ancPhonoPath)) {
        const ancRaw = JSON.parse(
          fs.readFileSync(ancPhonoPath, "utf-8"),
        ) as Partial<PhonologyConfig>;
        if (
          Array.isArray(ancRaw.glyph_annotations) &&
          ancRaw.glyph_annotations.length > 0
        ) {
          effectiveAnnotations = ancRaw.glyph_annotations;
          break;
        }
      }
      parentId = ancestor.parent_id ?? null;
    }
  }

  return {
    ...fallback,
    ...raw,
    language_id: raw.language_id ?? lang.language_id,
    phoneme_inventory: {
      consonants: raw.phoneme_inventory?.consonants ?? [],
      vowels: raw.phoneme_inventory?.vowels ?? [],
    },
    romanization_maps: raw.romanization_maps ?? [],
    phonotactics: {
      macros: raw.phonotactics?.macros ?? {},
      syllable_structure: raw.phonotactics?.syllable_structure ?? "(C)V(C)",
      blacklist_patterns: raw.phonotactics?.blacklist_patterns ?? [],
      vowel_harmony: raw.phonotactics?.vowel_harmony ?? {
        enabled: false,
        group_a: [],
        group_b: [],
      },
      tone_system: raw.phonotactics?.tone_system ?? {
        enabled: false,
        tones: [],
      },
    },
    allophony_rules: raw.allophony_rules ?? [],
    ...(effectiveAnnotations ? { glyph_annotations: effectiveAnnotations } : {}),
  };
}

function loadRawActiveWords(workspaceDir: string, lang: LanguageEntry): WordEntry[] {
  const lexDir = path.join(workspaceDir, lang.path, "lexicon");
  if (!fs.existsSync(lexDir)) return [];
  const files = fs
    .readdirSync(lexDir)
    .filter((f) => f.startsWith("lexicon_") && f.endsWith(".ndjson"))
    .sort();
  const words: WordEntry[] = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(lexDir, file), "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as Partial<WordEntry>;
        if (isValidWordEntry(parsed) && !parsed.evolution?.is_deprecated) {
          words.push(parsed as WordEntry);
        }
      } catch {
        // Ignore malformed NDJSON lines identically to Rust/TS reader
      }
    }
  }
  return words;
}

function loadRawCorpora(workspaceDir: string, lang: LanguageEntry): CorpusText[] {
  const corpusDir = path.join(workspaceDir, lang.path, "corpus");
  const indexPath = path.join(corpusDir, "corpus_index.json");
  if (!fs.existsSync(indexPath)) return [];
  try {
    const idx = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as CorpusIndexEntry[];
    if (!Array.isArray(idx)) return [];
    const out: CorpusText[] = [];
    for (const item of idx) {
      const textPath = path.join(corpusDir, `${item.corpus_id}.json`);
      if (fs.existsSync(textPath)) {
        out.push(JSON.parse(fs.readFileSync(textPath, "utf-8")) as CorpusText);
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function computeIndependentGroundTruth(
  workspaceDir: string,
): Promise<IndependentWorkspaceTruth> {
  const conlangPath = findConlangFile(workspaceDir);
  const ws = JSON.parse(fs.readFileSync(conlangPath, "utf-8")) as WorkspaceConfig;
  const languages = ws.languages ?? [];

  const parsedFontCache = new Map<
    string,
    { sha256: string; cmap: ReadonlySet<number> }
  >();

  async function inspectFontFile(
    filePath: string,
  ): Promise<{ sha256: string; cmap: ReadonlySet<number> }> {
    const cached = parsedFontCache.get(filePath);
    if (cached) return cached;
    const bytes = fs.readFileSync(filePath);
    const handle = await loadFontFromBytes(bytes, path.basename(filePath));
    const entry = { sha256: handle.sha256, cmap: handle.unicodes };
    parsedFontCache.set(filePath, entry);
    return entry;
  }

  const byLanguageId = new Map<string, IndependentLanguageTruth>();
  const distinctFontSha256s = new Set<string>();

  for (const lang of languages) {
    const langDir = path.join(workspaceDir, lang.path);
    const ownFont = findOwnFontIndependent(langDir);

    let resolvedFont: IndependentResolvedFont | null = null;
    if (ownFont) {
      const parsed = await inspectFontFile(ownFont);
      distinctFontSha256s.add(parsed.sha256);
      resolvedFont = {
        ownerLanguageId: lang.language_id,
        ownerName: lang.name,
        inherited: false,
        fileName: path.basename(ownFont),
        filePath: ownFont,
        sha256: parsed.sha256,
        cmap: parsed.cmap,
      };
    } else {
      const visited = new Set<string>([lang.language_id]);
      let parentId = lang.parent_id ?? null;
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const anc = languages.find((l) => l.language_id === parentId);
        if (!anc) break;
        const ancOwn = findOwnFontIndependent(path.join(workspaceDir, anc.path));
        if (ancOwn) {
          const parsed = await inspectFontFile(ancOwn);
          distinctFontSha256s.add(parsed.sha256);
          resolvedFont = {
            ownerLanguageId: anc.language_id,
            ownerName: anc.name,
            inherited: true,
            fileName: path.basename(ancOwn),
            filePath: ancOwn,
            sha256: parsed.sha256,
            cmap: parsed.cmap,
          };
          break;
        }
        parentId = anc.parent_id ?? null;
      }
    }

    let requiredCharsCount = 0;
    let missingCharsHex: string[] = [];
    let decomposedOnlyCount = 0;

    if (resolvedFont) {
      const phono = loadRawPhonologyWithInheritedAnnotations(
        workspaceDir,
        languages,
        lang,
      );
      const words = loadRawActiveWords(workspaceDir, lang);
      const corpora = loadRawCorpora(workspaceDir, lang);
      const audit = auditFontCoverage({
        phonology: phono,
        words,
        corpora,
        cmap: resolvedFont.cmap,
      });
      requiredCharsCount = audit.summary.required_chars;
      missingCharsHex = audit.missing_chars.map((c) => c.codepoint_hex).sort();
      decomposedOnlyCount = audit.summary.decomposed_only;
    }

    byLanguageId.set(lang.language_id, {
      language: lang,
      fontStatus: !resolvedFont
        ? "none"
        : resolvedFont.inherited
          ? "inherited"
          : "own",
      resolvedFont,
      requiredCharsCount,
      missingCharsHex,
      decomposedOnlyCount,
    });
  }

  return {
    conlangPath,
    languages,
    byLanguageId,
    distinctFontSha256s,
  };
}

async function withReadOnlyStdioClient<T>(
  rootDir: string,
  registryPath: string,
  fn: (helpers: {
    callOk: (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
    callErr: (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ code: string; message: string; details?: Record<string, unknown> }>;
  }) => Promise<T>,
): Promise<T> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      MCP_MAIN_PATH,
      "--mode",
      "read-only",
      "--toolsets",
      "all",
      "--registry",
      registryPath,
      "--allow-root",
      rootDir,
    ],
    cwd: REPO_ROOT,
    stderr: "pipe",
  });

  const client = new Client({ name: "mcp-acceptance", version: "1.0.0" });
  await client.connect(transport);

  const callOk = async (
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const res = await client.callTool({ name, arguments: args });
    const first = Array.isArray(res.content) ? res.content[0] : undefined;
    const text =
      first && typeof first === "object" && "text" in first && typeof first.text === "string"
        ? first.text
        : "{}";
    if (res.isError) {
      throw new Error(`Expected ${name} to succeed, got error: ${text}`);
    }
    return JSON.parse(text) as Record<string, unknown>;
  };

  const callErr = async (
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<{ code: string; message: string; details?: Record<string, unknown> }> => {
    const res = await client.callTool({ name, arguments: args });
    const first = Array.isArray(res.content) ? res.content[0] : undefined;
    const text =
      first && typeof first === "object" && "text" in first && typeof first.text === "string"
        ? first.text
        : "{}";
    assert(res.isError === true, `Expected ${name} to return isError: true, got: ${text}`);
    return JSON.parse(text) as {
      code: string;
      message: string;
      details?: Record<string, unknown>;
    };
  };

  try {
    return await fn({ callOk, callErr });
  } finally {
    await client.close();
  }
}

async function runPartASyntheticAcceptance(): Promise<void> {
  console.log("=== Part A: Synthetic Fixture Exact Acceptance (workspace-basic) ===");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-accept-synth-"));
  try {
    const workspaceCopy = path.join(tempRoot, "workspace-basic");
    fs.cpSync(SYNTHETIC_FIXTURE_DIR, workspaceCopy, { recursive: true });
    const conlangPath = path.join(workspaceCopy, "workspace.conlang");
    const registryPath = path.join(tempRoot, "registry.json");
    fs.writeFileSync(
      registryPath,
      JSON.stringify(
        {
          registry_version: "1.0",
          families: [
            {
              name: "Synthetic-Acceptance",
              conlang_file_path: conlangPath,
              last_opened: 1700000000,
            },
          ],
          active_family_index: 0,
        },
        null,
        2,
      ),
      "utf-8",
    );

    await withReadOnlyStdioClient(tempRoot, registryPath, async ({ callOk, callErr }) => {
      // 1. lang_root exact missing chars + provenance
      const rootReport = await callOk("font_audit_coverage", {
        language: "lang_root",
      });
      const rootMissing = rootReport.missing_chars as Array<Record<string, unknown>>;
      const rootMissingChars = new Set(rootMissing.map((m) => String(m.char)));
      for (const ch of ["c", "h", "i", "k", "x"]) {
        assert(
          rootMissingChars.has(ch),
          `lang_root missing_chars must contain "${ch}"`,
        );
      }
      const rootDecomposed = (
        rootReport.character_coverage as Record<string, unknown>
      ).decomposed_only as Array<Record<string, unknown>>;
      const aaInMissingOrDecomposed =
        rootMissingChars.has("ā") ||
        rootDecomposed.some((d) => String(d.char) === "ā");
      assert(
        aaInMissingOrDecomposed,
        'lang_root "ā" must be classified as missing or decomposed_only',
      );

      // 2. lang_child inherits font from lang_root
      const childReport = await callOk("font_audit_coverage", {
        language: "lang_child",
      });
      const childFont = childReport.font as Record<string, unknown>;
      assert(childFont.inherited === true, "lang_child font must be inherited");
      assert(
        childFont.owner_language_id === "lang_root",
        "lang_child font owner must be lang_root",
      );

      // 3. lang_leaf sequence unification (ch substituted, sh notdef since 's' absent in liga-test.ttf, x residual)
      const leafReport = await callOk("font_audit_coverage", {
        language: "lang_leaf",
        residual_glyph_pattern: "^roman\\.",
      });
      const seqs = leafReport.multi_char_sequences as Array<Record<string, unknown>>;
      const shSeq = seqs.find((s) => s.text === "sh");
      const chSeq = seqs.find((s) => s.text === "ch");
      assert(
        shSeq?.status === "notdef" && shSeq?.ligature_formed === false,
        `Expected lang_leaf "sh" status notdef (unencoded 's'), got ${String(shSeq?.status)}`,
      );
      assert(
        chSeq?.status === "substituted" && chSeq?.ligature_formed === true,
        `Expected lang_leaf "ch" status substituted, got ${String(chSeq?.status)}`,
      );
      const residuals = leafReport.residual_glyphs as Array<Record<string, unknown>>;
      assert(
        residuals.some((r) => String(r.glyph_name) === "roman.x"),
        "Expected lang_leaf residual_glyphs to report roman.x",
      );

      // 4. lang_other returns NO_FONT with ancestor_chain
      const otherErr = await callErr("font_audit_coverage", {
        language: "lang_other",
      });
      assert(otherErr.code === "NO_FONT", "lang_other must return NO_FONT");
      assert(
        Array.isArray(otherErr.details?.ancestor_chain),
        "lang_other NO_FONT details must include ancestor_chain",
      );

      // 5. font_audit_family deduplication & shared owner group
      const famReport = await callOk("font_audit_family");
      assert(famReport.total_languages === 4, "Expected 4 languages in family");
      assert(
        famReport.distinct_fonts_parsed === 2,
        `Expected 2 distinct fonts parsed, got ${String(famReport.distinct_fonts_parsed)}`,
      );
      const byFont = famReport.by_font as Array<Record<string, unknown>>;
      const rootGroup = byFont.find((g) => g.owner_language_id === "lang_root");
      assert(Boolean(rootGroup), "by_font must contain lang_root owner group");
      assert(
        (rootGroup?.inheriting_language_ids as string[]).includes("lang_child"),
        "lang_root by_font group must list lang_child in inheriting_language_ids",
      );

      // 6. Verify sequence_not_unified when all codepoints ARE in cmap without GSUB rule ("ca" in liga-test.ttf)
      const leafPhonoPath = path.join(workspaceCopy, "branches/leaf/phonology.json");
      const leafPhonoObj = JSON.parse(
        fs.readFileSync(leafPhonoPath, "utf-8"),
      ) as PhonologyConfig;
      leafPhonoObj.romanization_maps[0].rules.push({
        rule_id: "rule_leaf_ca",
        input: "ca",
        output_phoneme: "k",
        context_before: "",
        context_after: "",
      });
      fs.writeFileSync(leafPhonoPath, JSON.stringify(leafPhonoObj, null, 2), "utf-8");

      const leafReportWithCa = await callOk("font_audit_coverage", {
        language: "lang_leaf",
      });
      const seqsWithCa = leafReportWithCa.multi_char_sequences as Array<
        Record<string, unknown>
      >;
      const caSeq = seqsWithCa.find((s) => s.text === "ca");
      assert(
        caSeq?.status === "sequence_not_unified",
        `Expected "ca" (both 'c' & 'a' in cmap, no ligature) status sequence_not_unified, got ${String(caSeq?.status)}`,
      );
    });

    console.log("  ✓ Part A passed all synthetic exact assertions.");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function verifyWorkspaceAgainstMcp(
  tempRoot: string,
  registryPath: string,
  truth: IndependentWorkspaceTruth,
  label: string,
): Promise<void> {
  await withReadOnlyStdioClient(tempRoot, registryPath, async ({ callOk, callErr }) => {
    const tree = await callOk("family_get_tree", { include_word_counts: true });
    const treeLangs = tree.languages as Array<Record<string, unknown>>;
    assert(
      treeLangs.length === truth.languages.length,
      `[${label}] family_get_tree count mismatch: MCP=${treeLangs.length}, truth=${truth.languages.length}`,
    );
    for (const expectedLang of truth.languages) {
      const found = treeLangs.find(
        (l) => l.language_id === expectedLang.language_id,
      );
      assert(
        Boolean(found),
        `[${label}] Missing language ${expectedLang.language_id} in family_get_tree`,
      );
      assert(
        found?.name === expectedLang.name &&
          (found?.parent_id ?? null) === (expectedLang.parent_id ?? null),
        `[${label}] Topology mismatch for ${expectedLang.language_id}`,
      );
    }

    const fontList = await callOk("font_list");
    const fontStatuses = fontList.languages as Array<Record<string, unknown>>;
    assert(
      fontStatuses.length === truth.languages.length,
      `[${label}] font_list count mismatch`,
    );

    for (const [langId, langTruth] of truth.byLanguageId.entries()) {
      const mcpFontEntry = fontStatuses.find((f) => f.language_id === langId);
      assert(
        Boolean(mcpFontEntry),
        `[${label}] Missing ${langId} in font_list`,
      );
      assert(
        mcpFontEntry?.status === langTruth.fontStatus,
        `[${label}] font_list status mismatch on ${langId}: MCP=${String(mcpFontEntry?.status)}, truth=${langTruth.fontStatus}`,
      );

      if (!langTruth.resolvedFont) {
        const err = await callErr("font_audit_coverage", { language: langId });
        assert(
          err.code === "NO_FONT",
          `[${label}] Expected NO_FONT on ${langId}, got ${err.code}`,
        );
      } else {
        assert(
          mcpFontEntry?.resolved_owner_id ===
            langTruth.resolvedFont.ownerLanguageId,
          `[${label}] font_list owner mismatch on ${langId}`,
        );
        const cov = await callOk("font_audit_coverage", { language: langId });
        const covFont = cov.font as Record<string, unknown>;
        const covSummary = cov.summary as Record<string, unknown>;
        const covMissing = (cov.missing_chars as Array<Record<string, unknown>>)
          .map((c) => String(c.codepoint_hex))
          .sort();

        assert(
          covFont.owner_language_id === langTruth.resolvedFont.ownerLanguageId &&
            covFont.inherited === langTruth.resolvedFont.inherited &&
            covFont.sha256 === langTruth.resolvedFont.sha256,
          `[${label}] font_audit_coverage font metadata mismatch on ${langId}`,
        );
        assert(
          covSummary.required_chars === langTruth.requiredCharsCount &&
            covSummary.missing === langTruth.missingCharsHex.length &&
            covSummary.decomposed_only === langTruth.decomposedOnlyCount,
          `[${label}] font_audit_coverage summary mismatch on ${langId}: MCP=${JSON.stringify(covSummary)}, truth={required:${langTruth.requiredCharsCount},missing:${langTruth.missingCharsHex.length},decomposed:${langTruth.decomposedOnlyCount}}`,
        );
        if (
          cov.truncated === true &&
          typeof cov.missing_chars_total_before_truncation === "number"
        ) {
          assert(
            cov.missing_chars_total_before_truncation ===
              langTruth.missingCharsHex.length,
            `[${label}] Truncated missing_chars_total_before_truncation mismatch on ${langId}`,
          );
          const expectedSet = new Set(langTruth.missingCharsHex);
          for (const hex of covMissing) {
            assert(
              expectedSet.has(hex),
              `[${label}] Unexpected missing codepoint ${hex} on ${langId}`,
            );
          }
        } else {
          assert(
            JSON.stringify(covMissing) ===
              JSON.stringify(langTruth.missingCharsHex),
            `[${label}] font_audit_coverage missing codepoints mismatch on ${langId}`,
          );
        }
      }
    }

    const famAudit = await callOk("font_audit_family", { budget_ms: 60000 });
    assert(
      famAudit.total_languages === truth.languages.length,
      `[${label}] font_audit_family total_languages mismatch`,
    );
    assert(
      famAudit.audited_count === truth.languages.length && famAudit.partial === false,
      `[${label}] Expected complete non-partial family audit`,
    );
    const perLang = famAudit.per_language as Array<Record<string, unknown>>;
    for (const [langId, langTruth] of truth.byLanguageId.entries()) {
      const row = perLang.find((r) => r.language_id === langId);
      assert(Boolean(row), `[${label}] Missing ${langId} in font_audit_family`);
      if (!langTruth.resolvedFont) {
        assert(row?.status === "NO_FONT", `[${label}] Expected NO_FONT row on ${langId}`);
      } else {
        const rowMissing = (row?.missing_chars as Array<Record<string, unknown>>)
          .map((c) => String(c.codepoint))
          .sort();
        assert(
          JSON.stringify(rowMissing) === JSON.stringify(langTruth.missingCharsHex),
          `[${label}] font_audit_family missing_chars mismatch on ${langId}`,
        );
      }
    }
  });
}

async function runPartBTerraxAcceptance(terraxSourceDir: string): Promise<void> {
  console.log("=== Part B: Real Terrax Workspace Read-Only Copy Acceptance ===");
  console.log(`  Source (STRICTLY READ-ONLY): ${terraxSourceDir}`);

  const beforeManifest = computeDirectoryHashManifest(terraxSourceDir);
  console.log(
    `  BEFORE SHA-256: ${beforeManifest.aggregateSha256} (${beforeManifest.fileCount} files, ${beforeManifest.totalBytes} bytes)`,
  );

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-terrax-accept-"));
  try {
    const tempWorkspaceDir = path.join(tempRoot, "terrax-copy");
    fs.cpSync(terraxSourceDir, tempWorkspaceDir, { recursive: true });

    const initialTruth = await computeIndependentGroundTruth(tempWorkspaceDir);
    const resolvedRealSource = fs.realpathSync(terraxSourceDir);
    const resolvedTempConlang = fs.realpathSync(initialTruth.conlangPath);
    assert(
      !resolvedTempConlang.startsWith(resolvedRealSource),
      "Temporary .conlang path MUST NOT point inside original Terrax directory!",
    );

    const tempRegistryPath = path.join(tempRoot, "registry.json");
    fs.writeFileSync(
      tempRegistryPath,
      JSON.stringify(
        {
          registry_version: "1.0",
          families: [
            {
              name: "Terrax-Temp-Acceptance",
              conlang_file_path: resolvedTempConlang,
              last_opened: 1700000000,
            },
          ],
          active_family_index: 0,
        },
        null,
        2,
      ),
      "utf-8",
    );

    // Verify temporary registry strictly points only at temp copy
    const regRaw = JSON.parse(fs.readFileSync(tempRegistryPath, "utf-8")) as {
      families: Array<{ conlang_file_path: string }>;
    };
    assert(
      regRaw.families.length === 1 &&
        regRaw.families[0].conlang_file_path === resolvedTempConlang,
      "Registry must point exclusively to the temporary workspace copy",
    );

    const ownCount = Array.from(initialTruth.byLanguageId.values()).filter(
      (v) => v.fontStatus === "own",
    ).length;
    const inheritedCount = Array.from(initialTruth.byLanguageId.values()).filter(
      (v) => v.fontStatus === "inherited",
    ).length;
    const noneCount = Array.from(initialTruth.byLanguageId.values()).filter(
      (v) => v.fontStatus === "none",
    ).length;
    console.log(
      `  Ground truth loaded: ${initialTruth.languages.length} languages (own=${ownCount}, inherited=${inheritedCount}, none=${noneCount}), ${initialTruth.distinctFontSha256s.size} distinct font(s).`,
    );

    // 1. Verify unmutated temp copy against dynamic ground truth
    await verifyWorkspaceAgainstMcp(
      tempRoot,
      tempRegistryPath,
      initialTruth,
      "Terrax-Initial",
    );
    console.log("  ✓ Initial Terrax dynamic ground-truth verification passed.");

    // 2. Dynamic mutation check on TEMP COPY ONLY: install an own font on an inheriting/none language
    const targetCandidate =
      Array.from(initialTruth.byLanguageId.values()).find(
        (v) => v.fontStatus === "inherited",
      ) ??
      Array.from(initialTruth.byLanguageId.values()).find(
        (v) => v.fontStatus === "none",
      ) ??
      Array.from(initialTruth.byLanguageId.values())[0];

    assert(Boolean(targetCandidate), "Expected at least one language in Terrax copy");
    const targetLangDir = path.join(tempWorkspaceDir, targetCandidate.language.path);
    for (const existing of ["font.otf", "font.ttf"]) {
      const p = path.join(targetLangDir, existing);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    fs.copyFileSync(LIGA_FONT_PATH, path.join(targetLangDir, "font.ttf"));

    const mutatedTruth = await computeIndependentGroundTruth(tempWorkspaceDir);
    assert(
      mutatedTruth.byLanguageId.get(targetCandidate.language.language_id)?.fontStatus ===
        "own",
      "Mutated temp language must transition to fontStatus='own'",
    );

    await verifyWorkspaceAgainstMcp(
      tempRoot,
      tempRegistryPath,
      mutatedTruth,
      "Terrax-Mutated-Temp",
    );
    console.log(
      `  ✓ Temp-copy mutation check passed (installed own font on "${targetCandidate.language.name}" [${targetCandidate.language.language_id}] -> both ground truth & MCP updated identically).`,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    assert(!fs.existsSync(tempRoot), "Temporary Terrax copy must be removed in finally");
  }

  const afterManifest = computeDirectoryHashManifest(terraxSourceDir);
  console.log(
    `  AFTER  SHA-256: ${afterManifest.aggregateSha256} (${afterManifest.fileCount} files, ${afterManifest.totalBytes} bytes)`,
  );
  assert(
    afterManifest.aggregateSha256 === beforeManifest.aggregateSha256 &&
      afterManifest.fileCount === beforeManifest.fileCount &&
      afterManifest.totalBytes === beforeManifest.totalBytes,
    "CRITICAL: Original Terrax directory hash changed!",
  );
  console.log("  ✓ Original Terrax directory verified 100% untouched (0 bytes modified).");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let terraxDir =
    process.env.CONLANG_REAL_WORKSPACE_DIR ||
    process.env.TERRAX_WORKSPACE_DIR ||
    "";
  let allowSyntheticOnly = false;

  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--terrax" || argv[i] === "--workspace") && argv[i + 1]) {
      terraxDir = argv[++i];
    } else if (argv[i] === "--allow-synthetic-only") {
      allowSyntheticOnly = true;
    }
  }

  await runPartASyntheticAcceptance();

  if (terraxDir && fs.existsSync(terraxDir)) {
    await runPartBTerraxAcceptance(terraxDir);
  } else if (allowSyntheticOnly) {
    console.log(
      `[SKIP Part B] Real workspace directory not provided or not present (--allow-synthetic-only enabled).`,
    );
  } else {
    throw new Error(
      `Real workspace source directory not found${terraxDir ? ` at "${terraxDir}"` : ""}. Pass --workspace <dir> (or TERRAX_WORKSPACE_DIR) or --allow-synthetic-only in CI.`,
    );
  }

  console.log("✅ All T2.11 MCP acceptance checks passed.");
}

main().catch((err: unknown) => {
  console.error("❌ MCP acceptance failed:", err);
  process.exit(1);
});
