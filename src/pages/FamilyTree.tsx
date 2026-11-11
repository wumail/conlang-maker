import { useMemo, useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { GitFork, Plus } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type NodeTypes,
  type ColorMode,
  ConnectionLineType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useWorkspaceStore } from "../store/workspaceStore";
import type {
  LanguageEntry,
  LanguageFontStatus,
  LanguageWordStats,
} from "../types";
import { useFontStore } from "../store/fontStore";
import { BTN_PRIMARY, BTN_GHOST } from "../lib/ui";
import { TreeNode } from "../components/tree/TreeNodeRF";
import {
  FamilySelector,
  FamilyManager,
} from "../components/tree/FamilyManager";
import { FamilyTreeModals } from "../components/tree/FamilyTreeModals";
import { useTreeLayout, type TreeFlowNode } from "../utils/useTreeLayout";
import { useTheme } from "../lib/useTheme";
import { PageHeader } from "../components/common/PageHeader";
import { useRegistryStore } from "../store/registryStore";

const nodeTypes: NodeTypes = { treeNode: TreeNode } as NodeTypes;

export function FamilyTree() {
  const { t } = useTranslation();
  const {
    config,
    forkLanguage,
    deleteLanguage,
    setActiveLanguage,
    loadWorkspace,
    projectPath,
    conlangFilePath,
    createRootLanguage,
  } = useWorkspaceStore();
  const fontRevision = useFontStore((state) => state.revision);
  const { registerFamily, setActiveFamily } = useRegistryStore();
  const [fontStatuses, setFontStatuses] = useState<
    Record<string, LanguageFontStatus>
  >({});
  const [languageStats, setLanguageStats] = useState<
    Record<string, LanguageWordStats>
  >({});
  const [showForkModal, setShowForkModal] = useState(false);
  const [forkParentId, setForkParentId] = useState<string | null>(null);
  const [newLangName, setNewLangName] = useState("");
  const [showPullSync, setShowPullSync] = useState(false);
  const [showBorrowing, setShowBorrowing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LanguageEntry | null>(null);
  const [showCreateRoot, setShowCreateRoot] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [newRootName, setNewRootName] = useState("");
  const { theme } = useTheme();

  const loadWordCounts = useCallback(async (): Promise<void> => {
    const langs: [string, string][] = config.languages.map((l) => [l.language_id, l.path]);
    try {
      const stats = await invoke<Record<string, LanguageWordStats>>(
        "count_words_all_languages",
        { projectPath, languages: langs },
      );
      setLanguageStats(stats);
    } catch (err) {
      console.warn(`Failed to load word counts: ${err}`);
    }
  }, [config.languages, projectPath]);

  useEffect(() => {
    void loadWordCounts();
  }, [loadWordCounts]);

  const loadFonts = useCallback(async (): Promise<void> => {
    if (!projectPath || !conlangFilePath) return;
    try {
      const list = await invoke<LanguageFontStatus[]>("list_language_fonts", {
        projectPath,
        conlangFilePath,
      });
      setFontStatuses(
        Object.fromEntries(list.map((item) => [item.language_id, item])),
      );
    } catch (err) {
      console.warn(`Failed to load language fonts: ${err}`);
    }
  }, [projectPath, conlangFilePath]);

  const languageKey = config.languages.map((lang) => lang.language_id).join("|");
  useEffect(() => {
    void loadFonts();
  }, [loadFonts, fontRevision, languageKey]);

  const handleNodeFork = useCallback((parentId: string) => {
    setForkParentId(parentId);
    setShowForkModal(true);
  }, []);
  const handleNodeSwitch = useCallback(
    (languageId: string) => setActiveLanguage(languageId),
    [setActiveLanguage],
  );
  const handleNodeDelete = useCallback((lang: LanguageEntry) => {
    setDeleteTarget(lang);
  }, []);

  const callbacks = useMemo(
    () => ({
      onFork: handleNodeFork,
      onSwitch: handleNodeSwitch,
      onDelete: handleNodeDelete,
    }),
    [handleNodeFork, handleNodeSwitch, handleNodeDelete],
  );

  const { nodes: layoutNodes, edges: layoutEdges } = useTreeLayout(
    config.languages,
    languageStats,
    fontStatuses,
    callbacks,
  );

  const [nodes, setNodes, onNodesChange] =
    useNodesState<TreeFlowNode>(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  useEffect(() => {
    setNodes(layoutNodes);
    setEdges(layoutEdges);
  }, [layoutNodes, layoutEdges, setNodes, setEdges]);

  const handleFork = async (): Promise<void> => {
    if (!forkParentId || !newLangName.trim()) return;
    const newId = `lang_${Date.now().toString(36)}`;
    const newPath = `lang_${newId}`;
    try {
      await forkLanguage(forkParentId, newLangName.trim(), newId, newPath);
      setShowForkModal(false);
      setNewLangName("");
    } catch (err) {
      console.warn(`Fork failed: ${err}`);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await deleteLanguage(deleteTarget.language_id);
      setDeleteTarget(null);
    } catch (err) {
      console.warn(`Delete failed: ${err}`);
    }
  };

  const handleCreateRoot = async (): Promise<void> => {
    if (!newRootName.trim()) return;
    try {
      const result = await createRootLanguage(newRootName.trim());
      if (!result) return;
      const reg = await registerFamily(
        newRootName.trim(),
        result.conlang_file_path,
      );
      const idx = reg.families.findIndex(
        (f) => f.conlang_file_path === result.conlang_file_path,
      );
      if (idx >= 0) await setActiveFamily(idx);
      await loadWorkspace(result.conlang_file_path);
      setShowCreateRoot(false);
      setNewRootName("");
      await loadWordCounts();
    } catch (err) {
      console.warn(`Create root failed: ${err}`);
    }
  };

  const colorMode: ColorMode = theme === "dark" ? "dark" : "light";

  return (
    <div className="space-y-6 flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1">
          <PageHeader icon={<GitFork size={24} />} title={t("tree.title")} />
          <FamilySelector />
        </div>
        <div className="flex gap-2">
          <button
            className={BTN_PRIMARY}
            onClick={() => setShowCreateRoot(true)}
          >
            <Plus className="w-4 h-4" /> {t("tree.createRoot")}
          </button>
          <button
            className={BTN_GHOST}
            onClick={() => setShowPullSync(!showPullSync)}
          >
            {t("tree.pullSync")}
          </button>
          <button
            className={BTN_GHOST}
            onClick={() => setShowBorrowing(!showBorrowing)}
          >
            {t("tree.borrowing")}
          </button>
          <button
            className={BTN_GHOST}
            onClick={() => setShowSnapshots(!showSnapshots)}
            data-testid="open-snapshots-btn"
          >
            {t("tree.snapshots")}
          </button>
          <div className="border-l border-base-300 mx-1" />
          <FamilyManager />
        </div>
      </div>

      <div className="flex-1 min-h-0 rounded-lg border border-base-300 shadow shadow-inner bg-base-200/30 min-h-[400px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          connectionLineType={ConnectionLineType.SmoothStep}
          nodeTypes={nodeTypes}
          colorMode={colorMode}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.5}
          maxZoom={1}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          defaultEdgeOptions={{
            type: "smoothstep",
            style: { strokeWidth: 2 },
          }}
        >
          <Background gap={20} />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => {
              const d = n.data as unknown as { language: LanguageEntry };
              return d.language.language_id ===
                useWorkspaceStore.getState().activeLanguageId
                ? "oklch(0.7 0.15 250)"
                : "oklch(0.8 0.02 250)";
            }}
          />
        </ReactFlow>
      </div>

      <FamilyTreeModals
        languages={config.languages}
        showPullSync={showPullSync}
        onClosePullSync={() => setShowPullSync(false)}
        showBorrowing={showBorrowing}
        onCloseBorrowing={() => setShowBorrowing(false)}
        showSnapshots={showSnapshots}
        onCloseSnapshots={() => setShowSnapshots(false)}
        showForkModal={showForkModal}
        forkParentId={forkParentId}
        newLangName={newLangName}
        onNewLangNameChange={setNewLangName}
        onCloseFork={() => setShowForkModal(false)}
        onConfirmFork={() => void handleFork()}
        deleteTarget={deleteTarget}
        onCloseDelete={() => setDeleteTarget(null)}
        onConfirmDelete={() => void handleDelete()}
        showCreateRoot={showCreateRoot}
        newRootName={newRootName}
        onNewRootNameChange={setNewRootName}
        onCloseCreateRoot={() => setShowCreateRoot(false)}
        onConfirmCreateRoot={() => void handleCreateRoot()}
      />
    </div>
  );
}
