import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AppNav } from "./components/nav/AppNav";
import { ProjectStats } from "./components/nav/ProjectStats";
import { PhonologyPage } from "./pages/PhonologyPage";
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
import { useLexiconStore } from "./store/lexiconStore";
import { usePhonoStore } from "./store/phonoStore";
import { useGrammarStore } from "./store/grammarStore";
import { useWorkspaceStore } from "./store/workspaceStore";
import { useSCAStore } from "./store/scaStore";
import { useCorpusStore } from "./store/corpusStore";
import { useRegistryStore } from "./store/registryStore";
import { check } from "@tauri-apps/plugin-updater";
import "./App.css";

/** Routes that don't require a loaded workspace */
const PUBLIC_ROUTES = ["/welcome", "/about"];

function App() {
  const { loadFromBackend } = useLexiconStore();
  const { projectPath, activeLanguagePath, conlangFilePath } =
    useWorkspaceStore();
  const phonoLoadConfig = usePhonoStore((s) => s.loadConfig);
  const grammarLoadConfig = useGrammarStore((s) => s.loadConfig);
  const workspaceLoad = useWorkspaceStore((s) => s.loadWorkspace);
  const scaLoadConfig = useSCAStore((s) => s.loadConfig);
  const corpusLoadIndex = useCorpusStore((s) => s.loadIndex);
  const { loadRegistry, registry } = useRegistryStore();
  const location = useLocation();
  const [initDone, setInitDone] = useState(false);

  // 1. On mount, load registry and resolve active family
  useEffect(() => {
    const init = async () => {
      await loadRegistry();
      setInitDone(true);
    };
    init();
  }, []);

  // 2. When registry loads, auto-open active family if set
  useEffect(() => {
    if (!initDone) return;
    if (conlangFilePath) return; // already loaded
    if (
      registry.active_family_index !== null &&
      registry.active_family_index >= 0 &&
      registry.active_family_index < registry.families.length
    ) {
      const family = registry.families[registry.active_family_index];
      workspaceLoad(family.conlang_file_path);
    }
  }, [initDone, registry.active_family_index]);

  // 3. Reload data when active language changes
  const activeLanguageId = useWorkspaceStore((s) => s.activeLanguageId);
  useEffect(() => {
    if (!conlangFilePath) return;
    const reload = async () => {
      await loadFromBackend(projectPath, activeLanguagePath);
      await phonoLoadConfig(projectPath, activeLanguagePath);
      await grammarLoadConfig(projectPath, activeLanguagePath);
      await scaLoadConfig(projectPath, activeLanguagePath);
      await corpusLoadIndex(projectPath, activeLanguagePath);
    };
    reload();
  }, [projectPath, activeLanguagePath, activeLanguageId]);

  // 4. Silent updater check on startup; installs in background if a signed update is available.
  useEffect(() => {
    if (!initDone) return;
    const runSilentUpdate = async () => {
      try {
        const update = await check();
        if (update?.available) {
          await update.downloadAndInstall();
        }
      } catch {}
    };
    runSilentUpdate();
  }, [initDone]);

  // Route guard: if no workspace loaded, redirect to /welcome (except public routes)
  const isPublicRoute = PUBLIC_ROUTES.some((r) =>
    location.pathname.startsWith(r),
  );
  if (initDone && !conlangFilePath && !isPublicRoute) {
    return <Navigate to="/welcome" replace />;
  }

  // Show nothing while registry is loading
  if (!initDone) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-base-200">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-base-200 font-sans">
      {/* Hide nav on welcome page */}
      {location.pathname !== "/welcome" && <AppNav />}

      <main className="flex-1 flex flex-col overflow-hidden">
        <Routes>
          {/* Welcome page (no workspace required) */}
          <Route path="/welcome" element={<WelcomePage />} />

          {/* About page */}
          <Route path="/about" element={<AboutPage />} />

          {/* 默认跳转 */}
          <Route path="/" element={<Navigate to="/lexicon" replace />} />

          {/* 词典 */}
          <Route path="/lexicon" element={<LexiconPage />} />

          {/* 音系学（嵌套子路由） */}
          <Route path="/phonology/*" element={<PhonologyPage />}>
            <Route path="inventory" element={<IPAPanel />} />
            <Route path="romanization" element={<RomanizationEditor />} />
            <Route path="phonotactics" element={<PhonotacticsEditor />} />
            <Route path="allophony" element={<AllophonyEditor />} />
          </Route>

          {/* 语法（嵌套子路由） */}
          <Route path="/grammar/*" element={<GrammarPage />}>
            <Route path="typology" element={<TypologySection />} />
            <Route path="syntax" element={<SyntaxSection />} />
            <Route path="pos" element={<POSSection />} />
            <Route
              path="inflectionSystem"
              element={<InflectionSystemSection />}
            />
            <Route path="derivation" element={<DerivationEditor />} />
            <Route path="reference" element={<ReferenceSection />} />
          </Route>

          {/* 沙盒 */}
          <Route
            path="/sandbox"
            element={
              <div className="flex-1 p-8 overflow-y-auto">
                <Sandbox />
              </div>
            }
          />

          {/* 词语生成器 */}
          <Route
            path="/wordgen"
            element={
              <div className="flex-1 p-8 overflow-y-auto">
                <WordGenerator />
              </div>
            }
          />

          {/* SCA 历时音变 (Sprint 6) */}
          <Route
            path="/sca"
            element={
              <div className="flex-1 p-8 overflow-y-auto">
                <SCAEditor />
              </div>
            }
          />

          {/* 语系树 (Sprint 7) */}
          <Route
            path="/tree"
            element={
              <div className="flex-1 p-8 overflow-y-auto flex min-h-0">
                <FamilyTree />
              </div>
            }
          />

          {/* 语料库 */}
          <Route
            path="/corpus"
            element={
              <div className="flex-1 flex overflow-hidden">
                <CorpusPage />
              </div>
            }
          />

          {/* 导出导入 (Sprint 8) */}
          <Route
            path="/export"
            element={
              <div className="flex-1 p-8 overflow-y-auto">
                <ExportImport />
              </div>
            }
          />
        </Routes>
      </main>

      {/* Footer Stats Bar */}
      {location.pathname !== "/welcome" && <ProjectStats />}
    </div>
  );
}

export default App;
