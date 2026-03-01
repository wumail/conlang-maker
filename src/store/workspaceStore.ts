import { create } from 'zustand';
import { WorkspaceConfig, LanguageEntry, CreateProjectResult } from '../types';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { DEFAULT_LANGUAGE_ID, DEFAULT_LANGUAGE_PATH, WORKSPACE_VERSION } from '../constants';

interface WorkspaceStore {
    config: WorkspaceConfig;
    activeLanguageId: string;
    activeLanguagePath: string;
    /** Absolute path to the .conlang file — primary identifier */
    conlangFilePath: string;
    /** Derived: directory containing the .conlang file */
    projectPath: string;

    setConlangFilePath: (path: string) => void;
    loadWorkspace: (conlangFilePath: string) => Promise<void>;
    saveWorkspace: () => void;
    setActiveLanguage: (languageId: string) => void;
    forkLanguage: (parentId: string, newName: string, newId: string, newPath: string) => Promise<void>;
    deleteLanguage: (languageId: string) => Promise<void>;
    createRootLanguage: (name: string) => Promise<CreateProjectResult | null>;
    renameLanguage: (languageId: string, newName: string) => void;
    getLanguageById: (languageId: string) => LanguageEntry | undefined;
    getChildLanguages: (parentId: string) => LanguageEntry[];
    copyProject: (sourceConlangFilePath: string, destDir: string, newName: string) => Promise<string>;
    clearWorkspace: () => void;
}

const defaultConfig: WorkspaceConfig = {
    workspace_version: WORKSPACE_VERSION,
    languages: [
        {
            language_id: DEFAULT_LANGUAGE_ID,
            name: 'Proto Language',
            path: DEFAULT_LANGUAGE_PATH,
            parent_id: null,
        },
    ],
};

/** Derive projectPath (directory) from conlangFilePath */
function deriveProjectPath(conlangFilePath: string): string {
    const idx = Math.max(conlangFilePath.lastIndexOf('/'), conlangFilePath.lastIndexOf('\\'));
    return idx > 0 ? conlangFilePath.substring(0, idx) : '.';
}

let saveTimeout: ReturnType<typeof setTimeout>;

const debouncedSave = (conlangFilePath: string, config: WorkspaceConfig) => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        try {
            await invoke('save_workspace', { conlangFilePath, config });
        } catch (err) {
            console.warn(`工作区配置保存失败：${err}`);
        }
    }, 500);
};

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
    config: defaultConfig,
    activeLanguageId: DEFAULT_LANGUAGE_ID,
    activeLanguagePath: DEFAULT_LANGUAGE_PATH,
    conlangFilePath: '',
    projectPath: '.',

    setConlangFilePath: (path) => set({
        conlangFilePath: path,
        projectPath: deriveProjectPath(path),
    }),

    clearWorkspace: () => {
        set({
            projectPath: "",
            conlangFilePath: "",
            config: defaultConfig,
            activeLanguageId: "",
            activeLanguagePath: "",
        });
    },

    loadWorkspace: async (conlangFilePath: string) => {
        try {
            const config = await invoke<WorkspaceConfig>('load_workspace', { conlangFilePath });
            // If no languages registered, use default
            const languages = config.languages.length > 0 ? config.languages : defaultConfig.languages;
            const resolvedConfig = { ...config, languages };
            const projectPath = deriveProjectPath(conlangFilePath);
            set({
                config: resolvedConfig,
                conlangFilePath,
                projectPath,
                activeLanguageId: resolvedConfig.languages[0]?.language_id || undefined,
                activeLanguagePath: resolvedConfig.languages[0]?.path || undefined,
            });
        } catch (err) {
            console.warn(`加载工作区配置失败：${err}`);
        }
    },

    saveWorkspace: () => {
        const { conlangFilePath, config } = get();
        if (conlangFilePath) {
            debouncedSave(conlangFilePath, config);
        }
    },

    setActiveLanguage: (languageId: string) => {
        const { config } = get();
        const lang = config.languages.find((l) => l.language_id === languageId);
        if (lang) {
            set({
                activeLanguageId: lang.language_id,
                activeLanguagePath: lang.path,
            });
        }
    },

    forkLanguage: async (parentId, newName, newId, newPath) => {
        const { projectPath, conlangFilePath } = get();
        await invoke('fork_language', {
            projectPath,
            conlangFilePath,
            parentId,
            newName,
            newId,
            newPath,
        });
        // Reload workspace after fork
        await get().loadWorkspace(conlangFilePath);
    },

    deleteLanguage: async (languageId: string) => {
        const { projectPath, conlangFilePath, activeLanguageId, config } = get();
        await invoke('delete_language', { projectPath, conlangFilePath, languageId });
        // If deleting the active language, switch to first remaining
        if (activeLanguageId === languageId) {
            const remaining = config.languages.filter((l) => l.language_id !== languageId);
            if (remaining.length > 0) {
                set({
                    activeLanguageId: remaining[0].language_id,
                    activeLanguagePath: remaining[0].path,
                });
            }
        }
        await get().loadWorkspace(conlangFilePath);
    },

    createRootLanguage: async (name: string) => {
        // Let user choose a directory for the new project
        const selected = await open({ directory: true, title: 'Choose project directory' });
        if (!selected) return null;
        const newProjectPath = typeof selected === 'string' ? selected : String(selected);

        try {
            // Create a new project on disk with one root language
            const result = await invoke<CreateProjectResult>('create_new_project', {
                projectPath: newProjectPath,
                langName: name,
            });
            const conlangFilePath = result.conlang_file_path;
            const projectPath = deriveProjectPath(conlangFilePath);
            // Switch to the new project
            set({
                config: result.config,
                conlangFilePath,
                projectPath,
                activeLanguageId: result.config.languages[0].language_id,
                activeLanguagePath: result.config.languages[0].path,
            });
            return result;
        } catch (err) {
            console.warn(`创建根语言失败：${err}`);
            return null;
        }
    },

    renameLanguage: (languageId: string, newName: string) => {
        const { config, conlangFilePath } = get();
        const updatedConfig: WorkspaceConfig = {
            ...config,
            languages: config.languages.map((l) =>
                l.language_id === languageId ? { ...l, name: newName } : l,
            ),
        };
        set({ config: updatedConfig });
        if (conlangFilePath) {
            debouncedSave(conlangFilePath, updatedConfig);
        }
    },

    getLanguageById: (languageId: string) => {
        return get().config.languages.find((l) => l.language_id === languageId);
    },

    getChildLanguages: (parentId: string) => {
        return get().config.languages.filter((l) => l.parent_id === parentId);
    },

    copyProject: async (sourceConlangFilePath: string, destDir: string, newName: string) => {
        const newConlangPath = await invoke<string>('copy_project', {
            sourceConlangFilePath,
            destDir,
            newName,
        });
        return newConlangPath;
    },
}));
