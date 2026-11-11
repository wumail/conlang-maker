import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { WriteResult } from "../../types";
import {
  flushAllDomainStores,
  useWorkspaceStore,
} from "../../store/workspaceStore";
import { BTN_GHOST } from "../../lib/ui";
import { savePathSafely } from "../../utils/safeDialog";

export function TreeExportImport() {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);

  const handleExport = async (): Promise<void> => {
    setExporting(true);
    try {
      const filePath = await savePathSafely({
        title: t("tree.exportProject"),
        defaultPath: `conlang-project-${new Date().toISOString().slice(0, 10)}.conlang.json`,
        filters: [
          { name: "Conlang Project", extensions: ["conlang.json", "json"] },
        ],
      });
      if (!filePath) {
        setExporting(false);
        return;
      }
      await flushAllDomainStores();
      const { projectPath, conlangFilePath } = useWorkspaceStore.getState();
      const bundleJson = await invoke<string>("export_workspace_bundle", {
        projectPath,
        conlangFilePath,
      });
      await invoke<WriteResult>("write_text_file", {
        filePath,
        content: bundleJson,
      });
    } catch (err) {
      console.warn(`Export failed: ${err}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <button
      className={BTN_GHOST}
      onClick={() => void handleExport()}
      disabled={exporting}
    >
      <Download className="w-4 h-4" />
      {exporting ? t("common.loading") : t("tree.exportProject")}
    </button>
  );
}
