import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { SELECT } from "../../lib/ui";

export const DATASETS_KEY = "conlang-maker-datasets";

export interface DatasetEntry {
  path: string;
  label: string;
  lastOpened: string;
}

export function loadDatasets(): DatasetEntry[] {
  try {
    const raw = localStorage.getItem(DATASETS_KEY);
    if (raw) return JSON.parse(raw) as DatasetEntry[];
  } catch (err) {
    console.warn(`Failed to parse stored datasets: ${err}`);
  }
  return [];
}

export function saveDatasets(datasets: DatasetEntry[]): void {
  localStorage.setItem(DATASETS_KEY, JSON.stringify(datasets));
}

/** Compact dropdown for switching datasets — placed in the page header. */
export function DatasetSelector() {
  const { t } = useTranslation();
  const { conlangFilePath, setConlangFilePath, loadWorkspace } =
    useWorkspaceStore();
  const [datasets, setDatasets] = useState<DatasetEntry[]>(() =>
    loadDatasets(),
  );

  useEffect(() => {
    if (conlangFilePath && conlangFilePath !== ".") {
      setDatasets((prev) => {
        if (prev.some((d) => d.path === conlangFilePath)) return prev;
        const updated = [
          ...prev,
          {
            path: conlangFilePath,
            label: conlangFilePath.split("/").pop() || conlangFilePath,
            lastOpened: new Date().toISOString(),
          },
        ];
        saveDatasets(updated);
        return updated;
      });
    }
  }, [conlangFilePath]);

  const handleChange = async (
    e: React.ChangeEvent<HTMLSelectElement>,
  ): Promise<void> => {
    const selectedPath = e.target.value;
    if (!selectedPath || selectedPath === conlangFilePath) return;
    const updated = datasets.map((d) =>
      d.path === selectedPath
        ? { ...d, lastOpened: new Date().toISOString() }
        : d,
    );
    setDatasets(updated);
    saveDatasets(updated);
    setConlangFilePath(selectedPath);
    await loadWorkspace(selectedPath);
  };

  if (datasets.length <= 1) return null;

  return (
    <select
      className={`${SELECT} select-sm`}
      value={conlangFilePath}
      onChange={(e) => void handleChange(e)}
      title={t("dataset.title")}
    >
      {datasets.map((entry) => (
        <option key={entry.path} value={entry.path}>
          {entry.label}
        </option>
      ))}
    </select>
  );
}
