import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { check } from "@tauri-apps/plugin-updater";
import { useTranslation } from "react-i18next";
import { TitleBar } from "./components/nav/TitleBar";
import { useUndoShortcuts } from "./lib/useUndoShortcuts";
import { useCommandPaletteHotkey } from "./lib/useCommandPaletteHotkey";
import { CommandPalette } from "./components/common/CommandPalette";
import { AppNav } from "./components/nav/AppNav";
import { ProjectStats } from "./components/nav/ProjectStats";
import { ExternalConflictModal } from "./components/common/ExternalConflictModal";
import { PhonologyPage } from "./pages/PhonologyPage";
import { WritingPage } from "./pages/WritingPage";
import { FontPanel } from "./components/writing/FontPanel";
import { GlyphPanel } from "./components/writing/GlyphPanel";
import { IPAPanel } from "./components/phonology/IPAPanel";
import { RomanizationEditor } from "./components/phonology/RomanizationEditor";
import { PhonotacticsEditor } from "./components/phonology/PhonotacticsEditor";
import { AllophonyEditor } from "./components/phonology/AllophonyEditor";
import { GrammarPage } from "./pages/GrammarPage";
import { TypologySection } from "./components/grammar/TypologySection";
import { SyntaxSection } from "./components/grammar/SyntaxSection";
import { POSSection } from "./components/grammar/POSSection";
import { InflectionSystemSection } from "./components/grammar/InflectionSystemSection";
import { DerivationEditor } from "./components/grammar/DerivationEditor";
import { ReferenceSection } from "./components/grammar/ReferenceSection";
import { Sandbox } from "./components/sandbox/Sandbox";
import { WordGenerator } from "./components/wordgen/WordGenerator";
import { LexiconPage } from "./pages/LexiconPage";
import { SCAEditor } from "./pages/SCAEditor";
import { FamilyTree } from "./pages/FamilyTree";
import { ExportImport } from "./pages/ExportImport";
import { CorpusPage } from "./pages/CorpusPage";
import { WelcomePage } from "./pages/WelcomePage";
import { AboutPage } from "./pages/AboutPage";
import { McpSettingsPage } from "./pages/McpSettingsPage";
import { useLexiconStore } from "./store/lexiconStore";
import { usePhonoStore } from "./store/phonoStore";
import { useGrammarStore } from "./store/grammarStore";
import { useWorkspaceStore } from "./store/workspaceStore";
import { useSCAStore } from "./store/scaStore";
import { useCorpusStore } from "./store/corpusStore";
import { useRegistryStore } from "./store/registryStore";
import { useFontStore } from "./store/fontStore";
import { useConlangFont } from "./utils/conlangFont";
import { useProjectWatcher } from "./utils/externalChanges";
import "./App.css";

/** Routes that don't require a loaded workspace */
const PUBLIC_ROUTES = ["/welcome", "/about", "/mcp"];

function App() {
  const { t } = useTranslation();
  const { loadFromBackend } = useLexiconStore();
  const { projectPath, activeLanguagePath, conlangFilePath } = useWorkspaceStore();
  const phonoLoadConfig = usePhonoStore((s) => s.loadConfig);
  const grammarLoadConfig = useGrammarStore((s) => s.loadConfig);
  const workspaceLoad = useWorkspaceStore((s) => s.loadWorkspace);
  const scaLoadConfig = useSCAStore((s) => s.loadConfig);
  const corpusLoadIndex = useCorpusStore((s) => s.loadIndex);
  const { loadRegistry, registry } = useRegistryStore();
  const location = useLocation();
  const [initDone, setInitDone] = useState(false);
  const [loadedLanguage, setLoadedLanguage] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadRevision, setReloadRevision] = useState(0);
  const saveError = usePhonoStore((s) => s.saveError);
  const fontError = useFontStore((s) => s.error);

  useConlangFont();
  useUndoShortcuts();
  const commandPalette = useCommandPaletteHotkey();
  useProjectWatcher(projectPath, conlangFilePath);

  // 1. On mount, load registry and resolve active family
  useEffect(() => {
    const init = async (): Promise<void> => {
      await loadRegistry();
      setInitDone(true);
    };
    void init();
  }, [loadRegistry]);

  // 2. When registry loads, auto-open active family if set
  useEffect(() => {
    if (!initDone || conlangFilePath) return;
    if (
      registry.active_family_index !== null &&
      registry.active_family_index >= 0 &&
      registry.active_family_index < registry.families.length
    ) {
      const family = registry.families[registry.active_family_index];
      void workspaceLoad(family.conlang_file_path);
    }
  }, [initDone, conlangFilePath, registry.active_family_index, registry.families, workspaceLoad]);

  // 3. Reload data when active language changes
  const activeLanguageId = useWorkspaceStore((s) => s.activeLanguageId);
  const languageKey = JSON.stringify([projectPath, activeLanguagePath, activeLanguageId]);
  useEffect(() => {
    if (!conlangFilePath) return;
    let cancelled = false;
    setLoadedLanguage("");
    setLoadError(null);
    const reload = async (): Promise<void> => {
      try {
        await phonoLoadConfig(projectPath, activeLanguagePath);
        if (cancelled) return;
        await Promise.all([
          loadFromBackend(projectPath, activeLanguagePath),
          grammarLoadConfig(projectPath, activeLanguagePath),
          scaLoadConfig(projectPath, activeLanguagePath),
          corpusLoadIndex(projectPath, activeLanguagePath),
        ]);
        if (!cancelled) setLoadedLanguage(languageKey);
      } catch (error) {
        if (!cancelled) setLoadError(String(error));
      }
    };
    void reload();
    return () => {
      cancelled = true;
    };
  }, [
    projectPath,
    activeLanguagePath,
    activeLanguageId,
    conlangFilePath,
    reloadRevision,
    languageKey,
    phonoLoadConfig,
    loadFromBackend,
    grammarLoadConfig,
    scaLoadConfig,
    corpusLoadIndex,
  ]);

  // 4. Silent updater check on startup
  useEffect(() => {
    if (!initDone) return;
    const runSilentUpdate = async (): Promise<void> => {
      try {
        const update = await check();
        if (update?.available) {
          await update.downloadAndInstall();
        }
      } catch (err) {
        console.warn("Updater check skipped:", err);
      }
    };
    void runSilentUpdate();
  }, [initDone]);

  const isPublicRoute = PUBLIC_ROUTES.some((r) => location.pathname.startsWith(r));
  if (initDone && !conlangFilePath && !isPublicRoute) {
    return <Navigate to="/welcome" replace />;
  }

  if (!initDone) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-base-200">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  const showWorkspaceChrome = location.pathname !== "/welcome" && Boolean(conlangFilePath);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-base-200 font-sans">
      <TitleBar
        ready={loadedLanguage === languageKey && !loadError}
        onOpenCommandPalette={() => commandPalette.setOpen(true)}
      />

      <CommandPalette open={commandPalette.open} onClose={commandPalette.close} />

      {showWorkspaceChrome && <AppNav />}

      {saveError && (
        <div role="alert" className="alert alert-error rounded-none whitespace-pre-wrap">
          <span>
            {t("writing.saveFailed")} {saveError}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              void usePhonoStore
                .getState()
                .flushSaves()
                .catch((err) => console.warn("Retry phonology save failed:", err));
            }}
          >
            {t("writing.retry")}
          </button>
        </div>
      )}
      {fontError && (
        <div role="alert" className="alert alert-warning rounded-none">
          {t("writing.fontLoadFailed")} {fontError}
        </div>
      )}

      <main className="flex-1 flex flex-col overflow-hidden">
        {!isPublicRoute && (loadedLanguage !== languageKey || loadError) ? (
          <div
            role={loadError ? "alert" : "status"}
            className="flex-1 flex flex-col items-center justify-center gap-3 p-6"
          >
            {loadError ? (
              <>
                <p>{loadError}</p>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setLoadedLanguage("");
                    setReloadRevision((value) => value + 1);
                  }}
                >
                  {t("writing.retry")}
                </button>
              </>
            ) : (
              <span className="loading loading-spinner loading-lg" />
            )}
          </div>
        ) : (
          <Routes>
            <Route path="/welcome" element={<WelcomePage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route
              path="/mcp"
              element={
                <div className="flex-1 p-8 overflow-y-auto">
                  <McpSettingsPage />
                </div>
              }
            />
            <Route path="/" element={<Navigate to="/lexicon" replace />} />
            <Route path="/lexicon" element={<LexiconPage />} />
            <Route path="/phonology/*" element={<PhonologyPage />}>
              <Route path="inventory" element={<IPAPanel />} />
              <Route path="romanization" element={<RomanizationEditor />} />
              <Route path="phonotactics" element={<PhonotacticsEditor />} />
              <Route path="allophony" element={<AllophonyEditor />} />
            </Route>
            <Route path="/writing/*" element={<WritingPage />}>
              <Route path="font" element={<FontPanel />} />
              <Route path="glyphs" element={<GlyphPanel />} />
            </Route>
            <Route path="/grammar/*" element={<GrammarPage />}>
              <Route path="typology" element={<TypologySection />} />
              <Route path="syntax" element={<SyntaxSection />} />
              <Route path="pos" element={<POSSection />} />
              <Route path="inflectionSystem" element={<InflectionSystemSection />} />
              <Route path="derivation" element={<DerivationEditor />} />
              <Route path="reference" element={<ReferenceSection />} />
            </Route>
            <Route
              path="/sandbox"
              element={<div className="flex-1 p-8 overflow-y-auto"><Sandbox /></div>}
            />
            <Route
              path="/wordgen"
              element={<div className="flex-1 p-8 overflow-y-auto"><WordGenerator /></div>}
            />
            <Route
              path="/sca"
              element={<div className="flex-1 p-8 overflow-y-auto"><SCAEditor /></div>}
            />
            <Route
              path="/tree"
              element={<div className="flex-1 p-8 overflow-y-auto flex min-h-0"><FamilyTree /></div>}
            />
            <Route
              path="/corpus"
              element={<div className="flex-1 flex overflow-hidden"><CorpusPage /></div>}
            />
            <Route
              path="/export"
              element={<div className="flex-1 p-8 overflow-y-auto"><ExportImport /></div>}
            />
          </Routes>
        )}
      </main>

      {showWorkspaceChrome && <ProjectStats />}
      <ExternalConflictModal />
    </div>
  );
}

export default App;
