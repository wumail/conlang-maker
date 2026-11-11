import { invoke } from "@tauri-apps/api/core";
import type {
  CorpusIndexLoadResult,
  FontInspection,
  GrammarLoadResult,
  LexiconLoadResult,
  PhonologyLoadResult,
  ScaLoadResult,
  SnapshotScope,
  SnapshotSummary,
} from "../../types";
import { useWorkspaceStore } from "../../store/workspaceStore";

export type LanguageSnapshotScope = Exclude<SnapshotScope, "project">;

export const LANGUAGE_SNAPSHOT_SCOPES: LanguageSnapshotScope[] = [
  "lexicon",
  "phonology",
  "grammar",
  "sca",
  "corpus",
  "font",
];

export type ManualSnapshotTarget = "project" | LanguageSnapshotScope;
export type SnapshotScopeFilter = "all" | "project" | LanguageSnapshotScope;

export function formatSnapshotTimestamp(ts: string): string {
  const trimmed = ts.trim();
  if (!trimmed) return "";
  if (/^\d+$/.test(trimmed)) {
    const secs = Number.parseInt(trimmed, 10);
    return new Date(secs * 1000).toLocaleString();
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toLocaleString();
  }
  return trimmed;
}

export async function resolveExpectedRevisionForSnapshot(
  snap: SnapshotSummary,
  projectPath: string,
  conlangFilePath: string,
): Promise<string> {
  const ws = useWorkspaceStore.getState();
  if (snap.level === "project" || snap.archived_language || !snap.language_id) {
    return ws.revision;
  }

  const lang = ws.config.languages.find(
    (l) => l.language_id === snap.language_id,
  );
  if (!lang) {
    return ws.revision;
  }

  switch (snap.scope) {
    case "phonology": {
      const res = await invoke<PhonologyLoadResult>("load_phonology", {
        projectPath,
        languagePath: lang.path,
      });
      return res.revision;
    }
    case "grammar": {
      const res = await invoke<GrammarLoadResult>(
        "load_grammar_with_revision",
        {
          projectPath,
          languagePath: lang.path,
        },
      );
      return res.revision;
    }
    case "sca": {
      const res = await invoke<ScaLoadResult>("load_sca_with_revision", {
        projectPath,
        languagePath: lang.path,
      });
      return res.revision;
    }
    case "lexicon": {
      const res = await invoke<LexiconLoadResult>(
        "load_all_words_with_revision",
        {
          projectPath,
          languagePath: lang.path,
        },
      );
      return res.revision;
    }
    case "corpus": {
      const res = await invoke<CorpusIndexLoadResult>(
        "load_corpus_index_with_revision",
        {
          projectPath,
          languagePath: lang.path,
        },
      );
      return res.revision;
    }
    case "font": {
      const res = await invoke<FontInspection>("inspect_language_font", {
        projectPath,
        conlangFilePath,
        languageId: lang.language_id,
      });
      return res.revision ?? "missing";
    }
    default:
      return ws.revision;
  }
}
