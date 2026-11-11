import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectLegacyWritingFromRaw } from "../storage/legacy";
import {
  inspectLanguageFont,
  listLanguageFontStatuses,
  readCorpusIndex,
  readCorpusText,
  readGrammar,
  readLexicon,
  readPhonology,
  readSca,
  readWorkspace,
} from "../storage/read";

function repoRoot(): string {
  return path.resolve(import.meta.dir, "..", "..");
}

function copyDirRecursive(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

function canonicalizeJson(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map(canonicalizeJson);
  }
  if (typeof val === "object" && val !== null) {
    const rec = val as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(rec).sort()) {
      if (rec[key] !== undefined) {
        out[key] = canonicalizeJson(rec[key]);
      }
    }
    return out;
  }
  return val;
}

function normalizeLexiconSkippedReasons(val: unknown): unknown {
  const c = canonicalizeJson(val) as Record<string, unknown>;
  if (Array.isArray(c.skipped)) {
    c.skipped = (c.skipped as Record<string, unknown>[]).map((s) => ({
      ...s,
      reason:
        typeof s.reason === "string" && s.reason.startsWith("invalid_json:")
          ? "invalid_json"
          : s.reason,
    }));
  }
  return c;
}

function loadGolden(goldenDir: string, fileName: string): unknown {
  const fullPath = path.join(goldenDir, fileName);
  return canonicalizeJson(JSON.parse(fs.readFileSync(fullPath, "utf-8")));
}

describe("T2.5 Rust <-> TypeScript Golden Conformance", () => {
  test("all workspace-basic read outputs match Rust golden snapshots bit-for-bit", async () => {
    const root = repoRoot();
    const srcFixture = path.join(root, "tests", "fixtures", "workspace-basic");
    const goldenDir = path.join(root, "tests", "golden");
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-mcp-conformance-"));

    try {
      const projDir = path.join(tmpRoot, "workspace-basic");
      copyDirRecursive(srcFixture, projDir);
      const wsPath = path.join(projDir, "workspace.conlang");

      const wsRes = await readWorkspace(wsPath, "read-only");
      expect(canonicalizeJson(wsRes)).toEqual(loadGolden(goldenDir, "workspace.json"));

      const fontsList = await listLanguageFontStatuses(projDir, wsPath, "read-only");
      expect(canonicalizeJson(fontsList)).toEqual(
        loadGolden(goldenDir, "fonts_list.json"),
      );

      for (const lang of wsRes.config.languages) {
        const id = lang.language_id;

        const phonoDto = await readPhonology(
          projDir,
          wsPath,
          lang,
          "read-only",
        );
        const phonoRawPath = path.join(projDir, lang.path, "phonology.json");
        const phonoRawObj = fs.existsSync(phonoRawPath)
          ? (JSON.parse(fs.readFileSync(phonoRawPath, "utf-8")) as Record<
              string,
              unknown
            >)
          : {};
        const legacyInspection = inspectLegacyWritingFromRaw(phonoRawObj);

        expect(canonicalizeJson(phonoDto)).toEqual(
          loadGolden(goldenDir, `phonology_${id}.json`),
        );
        expect(canonicalizeJson(legacyInspection)).toEqual(
          loadGolden(goldenDir, `legacy_writing_${id}.json`),
        );

        const lex = await readLexicon(projDir, lang, "read-only");
        expect(normalizeLexiconSkippedReasons(lex)).toEqual(
          normalizeLexiconSkippedReasons(loadGolden(goldenDir, `lexicon_${id}.json`)),
        );

        const gram = await readGrammar(projDir, lang, "read-only");
        expect(canonicalizeJson(gram)).toEqual(
          loadGolden(goldenDir, `grammar_${id}.json`),
        );

        const sca = await readSca(projDir, lang, "read-only");
        expect(canonicalizeJson(sca)).toEqual(
          loadGolden(goldenDir, `sca_${id}.json`),
        );

        const cidx = await readCorpusIndex(projDir, lang, "read-only");
        expect(canonicalizeJson(cidx)).toEqual(
          loadGolden(goldenDir, `corpus_index_${id}.json`),
        );

        for (const entry of cidx.entries) {
          const ctext = await readCorpusText(
            projDir,
            lang,
            entry.corpus_id,
            "read-only",
          );
          expect(canonicalizeJson(ctext)).toEqual(
            loadGolden(goldenDir, `corpus_text_${id}_${entry.corpus_id}.json`),
          );
        }

        const finspect = await inspectLanguageFont(projDir, wsPath, id, "read-only");
        expect(canonicalizeJson(finspect)).toEqual(
          loadGolden(goldenDir, `font_inspect_${id}.json`),
        );
      }
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
