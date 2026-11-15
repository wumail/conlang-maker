/**
 * CrossProjectSourceSelector.tsx — 跨项目借词的「项目 → 语言」选择器（Roadmap v3 / Pillar 1）
 *
 * 供语项目默认当前项目，可选全局注册表中的其他项目；外部项目通过
 * `load_workspace` + `load_all_words_with_revision` 只读加载，不修改对方数据。
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { FolderInput, RotateCw } from "lucide-react";
import { useRegistryStore } from "../../store/registryStore";
import { deriveProjectPath } from "../../store/workspaceStore";
import type { LanguageEntry, LexiconLoadResult, WordEntry, WorkspaceConfig } from "../../types";
import { SELECT, BTN_PRIMARY_MD, BTN_GHOST_SQ } from "../../lib/ui";

export interface LoadedSourceContext {
  projectLabel: string;
  conlangFilePath: string;
  projectPath: string;
  language: LanguageEntry;
  words: WordEntry[];
}

interface CrossProjectSourceSelectorProps {
  currentConlangPath: string;
  currentProjectLabel: string;
  /** 当前语言不能作为自己的供语 */
  excludeLanguageIds: string[];
  onLoaded: (context: LoadedSourceContext | null) => void;
}

export const CrossProjectSourceSelector: React.FC<CrossProjectSourceSelectorProps> = ({
  currentConlangPath,
  currentProjectLabel,
  excludeLanguageIds,
  onLoaded,
}) => {
  const { t } = useTranslation();
  const families = useRegistryStore((s) => s.registry.families);
  const [conlangFilePath, setConlangFilePath] = useState(currentConlangPath);
  const [languages, setLanguages] = useState<LanguageEntry[]>([]);
  const [languageId, setLanguageId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const excludeKey = excludeLanguageIds.join("|");

  const projectOptions = useMemo(() => {
    const options = [
      { label: currentProjectLabel || t("tree.borrowingV3.currentProject"), path: currentConlangPath },
    ];
    for (const family of families) {
      if (!family.conlang_file_path || family.conlang_file_path === currentConlangPath) continue;
      options.push({ label: family.name, path: family.conlang_file_path });
    }
    return options;
  }, [families, currentConlangPath, currentProjectLabel, t]);

  // 切换项目即只读加载其语言清单，并默认选中首个可用供语
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      onLoaded(null);
      try {
        const config = await invoke<WorkspaceConfig>("load_workspace", {
          conlangFilePath,
        });
        if (cancelled) return;
        // 只有选中本项目的 .conlang 时才排除「当前语言」；外部项目里可能存在同 ID 的语言
        // （如都叫 lang_proto），按 ID 排除会让外部项目的供语列表凭空少一门语言。
        const sameProject = conlangFilePath === currentConlangPath;
        const excluded = sameProject && excludeKey ? excludeKey.split("|") : [];
        const allowed = config.languages.filter(
          (language) => !excluded.includes(language.language_id),
        );
        setLanguages(allowed);
        setLanguageId(allowed[0]?.language_id ?? "");
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`Failed to load source workspace ${conlangFilePath}: ${message}`);
        setLanguages([]);
        setLanguageId("");
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [conlangFilePath, currentConlangPath, excludeKey, onLoaded]);

  const loadWords = async (): Promise<void> => {
    const language = languages.find((item) => item.language_id === languageId);
    if (!language) return;
    setLoading(true);
    setError(null);
    try {
      const projectPath = deriveProjectPath(conlangFilePath);
      const loaded = await invoke<LexiconLoadResult>("load_all_words_with_revision", {
        projectPath,
        languagePath: language.path,
      });
      onLoaded({
        projectLabel:
          projectOptions.find((option) => option.path === conlangFilePath)?.label ??
          conlangFilePath,
        conlangFilePath,
        projectPath,
        language,
        words: loaded.words,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Failed to load source words: ${message}`);
      setError(message);
      onLoaded(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 text-xs font-medium text-base-content/60">
        <FolderInput size={13} />
        {t("lexicon.etymologyV3.crossProjectLabel")}
      </div>

      <select
        className={`${SELECT} w-full`}
        value={conlangFilePath}
        onChange={(event) => setConlangFilePath(event.target.value)}
      >
        {projectOptions.map((option) => (
          <option key={option.path} value={option.path}>
            {option.label}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-2">
        <select
          className={`${SELECT} flex-1`}
          value={languageId}
          onChange={(event) => setLanguageId(event.target.value)}
          disabled={languages.length === 0}
        >
          <option value="">{t("tree.selectSource")}</option>
          {languages.map((language) => (
            <option key={language.language_id} value={language.language_id}>
              {language.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={BTN_PRIMARY_MD}
          onClick={() => void loadWords()}
          disabled={!languageId || loading}
        >
          {t("tree.loadWords")}
        </button>
        <button
          type="button"
          className={BTN_GHOST_SQ}
          title={t("tree.borrowingV3.retry")}
          onClick={() => void loadWords()}
          disabled={!languageId || loading}
        >
          <RotateCw size={12} />
        </button>
      </div>

      {error && <p className="text-xs text-error">{t("tree.borrowingV3.loadFailed")}</p>}
    </div>
  );
};
