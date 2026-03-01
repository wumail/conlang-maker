import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { GlobalRegistry, FamilyEntry } from '../types';

interface RegistryStore {
  registry: GlobalRegistry;
  loaded: boolean;

  loadRegistry: () => Promise<void>;
  registerFamily: (name: string, conlangFilePath: string) => Promise<GlobalRegistry>;
  unregisterFamily: (index: number) => Promise<GlobalRegistry>;
  setActiveFamily: (index: number) => Promise<GlobalRegistry>;
  validateConlangFile: (conlangFilePath: string) => Promise<string[]>;
  getActiveFamily: () => FamilyEntry | null;
}

const defaultRegistry: GlobalRegistry = {
  registry_version: '1.0',
  families: [],
  active_family_index: null,
};

export const useRegistryStore = create<RegistryStore>((set, get) => ({
  registry: defaultRegistry,
  loaded: false,

  loadRegistry: async () => {
    try {
      const registry = await invoke<GlobalRegistry>('load_registry');
      set({ registry, loaded: true });
    } catch (err) {
      console.warn(`Failed to load registry: ${err}`);
      set({ registry: defaultRegistry, loaded: true });
    }
  },

  registerFamily: async (name: string, conlangFilePath: string) => {
    const registry = await invoke<GlobalRegistry>('register_family', {
      name,
      conlangFilePath,
    });
    set({ registry });
    return registry;
  },

  unregisterFamily: async (index: number) => {
    const registry = await invoke<GlobalRegistry>('unregister_family', { index });
    set({ registry });
    return registry;
  },

  setActiveFamily: async (index: number) => {
    const registry = await invoke<GlobalRegistry>('set_active_family', { index });
    set({ registry });
    return registry;
  },

  validateConlangFile: async (conlangFilePath: string) => {
    return invoke<string[]>('validate_conlang_file', { conlangFilePath });
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
}));
