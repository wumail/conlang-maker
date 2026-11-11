import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  FamilyEntry,
  GlobalRegistry,
  RegistryLoadResult,
  WriteResult,
} from "../types";
import { isConflictError } from "./conflictStore";

interface RegistryStore {
  registry: GlobalRegistry;
  revision: string;
  loaded: boolean;

  loadRegistry: () => Promise<void>;
  saveRegistry: (nextRegistry: GlobalRegistry) => Promise<void>;
  registerFamily: (
    name: string,
    conlangFilePath: string,
  ) => Promise<GlobalRegistry>;
  unregisterFamily: (index: number) => Promise<GlobalRegistry>;
  setActiveFamily: (index: number) => Promise<GlobalRegistry>;
  validateConlangFile: (conlangFilePath: string) => Promise<string[]>;
  getActiveFamily: () => FamilyEntry | null;
}

const defaultRegistry: GlobalRegistry = {
  registry_version: "1.0",
  families: [],
  active_family_index: null,
};

export const useRegistryStore = create<RegistryStore>((set, get) => {
  const syncLatestRevision = async (): Promise<RegistryLoadResult> => {
    const loaded = await invoke<RegistryLoadResult>(
      "load_registry_with_revision",
    );
    set({
      registry: loaded.registry,
      revision: loaded.revision,
      loaded: true,
    });
    return loaded;
  };

  return {
    registry: defaultRegistry,
    revision: "missing",
    loaded: false,

    loadRegistry: async () => {
      try {
        await syncLatestRevision();
      } catch (err) {
        console.warn(`Failed to load registry: ${err}`);
        set({ registry: defaultRegistry, revision: "missing", loaded: true });
      }
    },

    saveRegistry: async (nextRegistry: GlobalRegistry) => {
      const merged: GlobalRegistry = {
        ...get().registry,
        ...nextRegistry,
      };
      const res = await invoke<WriteResult>("save_registry", {
        registry: merged,
        expectedRevision: get().revision,
      });
      set({ registry: merged, revision: res.revision });
    },

    registerFamily: async (name: string, conlangFilePath: string) => {
      try {
        await invoke<GlobalRegistry>("register_family", {
          name,
          conlangFilePath,
          expectedRevision: get().revision,
        });
      } catch (err) {
        if (isConflictError(err)) {
          const fresh = await syncLatestRevision();
          await invoke<GlobalRegistry>("register_family", {
            name,
            conlangFilePath,
            expectedRevision: fresh.revision,
          });
        } else {
          throw err;
        }
      }
      const synced = await syncLatestRevision();
      return synced.registry;
    },

    unregisterFamily: async (index: number) => {
      try {
        await invoke<GlobalRegistry>("unregister_family", {
          index,
          expectedRevision: get().revision,
        });
      } catch (err) {
        if (isConflictError(err)) {
          const fresh = await syncLatestRevision();
          await invoke<GlobalRegistry>("unregister_family", {
            index,
            expectedRevision: fresh.revision,
          });
        } else {
          throw err;
        }
      }
      const synced = await syncLatestRevision();
      return synced.registry;
    },

    setActiveFamily: async (index: number) => {
      try {
        await invoke<GlobalRegistry>("set_active_family", {
          index,
          expectedRevision: get().revision,
        });
      } catch (err) {
        if (isConflictError(err)) {
          const fresh = await syncLatestRevision();
          await invoke<GlobalRegistry>("set_active_family", {
            index,
            expectedRevision: fresh.revision,
          });
        } else {
          throw err;
        }
      }
      const synced = await syncLatestRevision();
      return synced.registry;
    },

    validateConlangFile: async (conlangFilePath: string) => {
      return invoke<string[]>("validate_conlang_file", { conlangFilePath });
    },

    getActiveFamily: () => {
      const { registry } = get();
      if (
        registry.active_family_index !== null &&
        registry.active_family_index >= 0 &&
        registry.active_family_index < registry.families.length
      ) {
        return registry.families[registry.active_family_index];
      }
      return null;
    },
  };
});
