import { useMemo, useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { GitFork, AlertTriangle, Plus } from "lucide-react";
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
import { LanguageEntry } from "../types";
import { BTN_PRIMARY, BTN_GHOST, BTN_OUTLINE_ERROR, INPUT } from "../lib/ui";
import { TreeNode } from "../components/tree/TreeNodeRF";
import { PullSync } from "../components/tree/PullSync";
import { BorrowingPanel } from "../components/tree/BorrowingPanel";
import {
  FamilySelector,
  FamilyManager,
} from "../components/tree/FamilyManager";
import { SnapshotManager } from "../components/tree/SnapshotManager";
import { useTreeLayout, type TreeFlowNode } from "../utils/useTreeLayout";
import { useTheme } from "../lib/useTheme";
import { ModalPortal } from "../components/common/ModalPortal";
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
    createRootLanguage,
  } = useWorkspaceStore();
  const { registerFamily, setActiveFamily } = useRegistryStore();
  const [languageStats, setLanguageStats] = useState<
    Record<
      string,
      {
        word_count: number;
        created_at: number | null;
        updated_at: number | null;
      }
    >
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

  // Load word counts from backend for all languages
  const loadWordCounts = useCallback(async () => {
    try {
      const langs: [string, string][] = config.languages.map((l) => [
        l.language_id,
        l.path,
      ]);
      const stats = await invoke<
        Record<
          string,
          {
            word_count: number;
            created_at: number | null;
            updated_at: number | null;
          }
        >
      >("count_words_all_languages", {
        projectPath,
        languages: langs,
      });
      setLanguageStats(stats);
    } catch (err) {
      console.warn(`Failed to load word counts: ${err}`);
    }
  }, [config.languages, projectPath]);

  useEffect(() => {
    loadWordCounts();
  }, [loadWordCounts]);

  // Callbacks for tree nodes — stabilise with useCallback
  const handleNodeFork = useCallback((parentId: string) => {
    setForkParentId(parentId);
    setShowForkModal(true);
  }, []);

  const handleNodeSwitch = useCallback(
    (languageId: string) => {
      setActiveLanguage(languageId);
    },
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

  // dagre layout
  const { nodes: layoutNodes, edges: layoutEdges } = useTreeLayout(
    config.languages,
    languageStats,
    callbacks,
  );

  const [nodes, setNodes, onNodesChange] =
    useNodesState<TreeFlowNode>(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  // Re-sync when layout changes (languages / word counts change)
  useEffect(() => {
    setNodes(layoutNodes);
    setEdges(layoutEdges);
  }, [layoutNodes, layoutEdges, setNodes, setEdges]);

  const handleFork = async () => {
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

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteLanguage(deleteTarget.language_id);
      setDeleteTarget(null);
    } catch (err) {
      console.warn(`Delete failed: ${err}`);
    }
  };

  const handleCreateRoot = async () => {
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

  // Derive ReactFlow colorMode from theme
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
          >
            {t("tree.snapshots")}
          </button>
          <div className="border-l border-base-300 mx-1" />
          <FamilyManager />
        </div>
      </div>

      {/* Tree visualization — ReactFlow */}
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

      <ModalPortal
        open={
          showPullSync ||
          showBorrowing ||
          showSnapshots ||
          showForkModal ||
          !!deleteTarget ||
          showCreateRoot
        }
      >
        <>
          {/* Panels as modals */}
          {showPullSync && (
            <div className="modal modal-open">
              <div className="modal-box max-w-lg">
                <PullSync />
                <div className="modal-action">
                  <button
                    className={BTN_GHOST}
                    onClick={() => setShowPullSync(false)}
                  >
                    {t("common.close")}
                  </button>
                </div>
              </div>
            </div>
          )}
          {showBorrowing && (
            <div className="modal modal-open">
              <div className="modal-box max-w-2xl">
                <BorrowingPanel />
                <div className="modal-action">
                  <button
                    className={BTN_GHOST}
                    onClick={() => setShowBorrowing(false)}
                  >
                    {t("common.close")}
                  </button>
                </div>
              </div>
            </div>
          )}
          {showSnapshots && (
            <div className="modal modal-open">
              <div className="modal-box max-w-lg">
                <SnapshotManager />
                <div className="modal-action mt-2">
                  <button
                    className={BTN_GHOST}
                    onClick={() => setShowSnapshots(false)}
                  >
                    {t("common.close")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Fork Modal */}
          {showForkModal && (
            <div className="modal modal-open">
              <div className="modal-box">
                <h3 className="font-bold text-lg">{t("tree.forkTitle")}</h3>
                <p className="py-2 text-sm text-base-content/60">
                  {t("tree.forkFrom")}:{" "}
                  {
                    config.languages.find((l) => l.language_id === forkParentId)
                      ?.name
                  }
                </p>
                <div className="form-control">
                  <label className="label">
                    <span className="label-text">{t("tree.newLangName")}</span>
                  </label>
                  <input
                    className={`${INPUT} w-full`}
                    value={newLangName}
                    onChange={(e) => setNewLangName(e.target.value)}
                    placeholder={t("tree.newLangNamePlaceholder")}
                  />
                </div>
                <div className="modal-action">
                  <button
                    className={BTN_GHOST}
                    onClick={() => setShowForkModal(false)}
                  >
                    {t("common.close")}
                  </button>
                  <button
                    className={BTN_PRIMARY}
                    onClick={handleFork}
                    disabled={!newLangName.trim()}
                  >
                    <GitFork className="w-4 h-4" /> {t("tree.fork")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Delete Confirmation Modal */}
          {deleteTarget && (
            <div className="modal modal-open">
              <div className="modal-box">
                <h3 className="font-bold text-lg flex items-center gap-2 text-error">
                  <AlertTriangle size={20} /> {t("tree.deleteConfirmTitle")}
                </h3>
                <p className="py-3 text-sm text-base-content/70">
                  {t("tree.deleteConfirmMsg", { name: deleteTarget.name })}
                </p>
                <div className="modal-action">
                  <button
                    className={BTN_GHOST}
                    onClick={() => setDeleteTarget(null)}
                  >
                    {t("common.close")}
                  </button>
                  <button className={BTN_OUTLINE_ERROR} onClick={handleDelete}>
                    {t("tree.confirmDelete")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Create Root Language Modal */}
          {showCreateRoot && (
            <div className="modal modal-open">
              <div className="modal-box">
                <h3 className="font-bold text-lg">{t("tree.createRoot")}</h3>
                <div className="form-control mt-3">
                  <label className="label mb-3">
                    <span className="label-text">{t("tree.newLangName")}</span>
                  </label>
                  <input
                    className={`${INPUT} w-full`}
                    value={newRootName}
                    onChange={(e) => setNewRootName(e.target.value)}
                    placeholder={t("tree.newLangNamePlaceholder")}
                  />
                </div>
                <div className="modal-action">
                  <button
                    className={BTN_GHOST}
                    onClick={() => setShowCreateRoot(false)}
                  >
                    {t("common.close")}
                  </button>
                  <button
                    className={BTN_PRIMARY}
                    onClick={handleCreateRoot}
                    disabled={!newRootName.trim()}
                  >
                    <Plus className="w-4 h-4" /> {t("tree.createRoot")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
        ,
      </ModalPortal>
    </div>
  );
}
