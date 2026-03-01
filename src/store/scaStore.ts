import { create } from 'zustand';
import { SCAConfig, SCARuleSet, SCARule } from '../types';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_LANGUAGE_ID } from '../constants';

interface SCAStore {
    config: SCAConfig;
    projectPath: string;
    languagePath: string;

    loadConfig: (projectPath: string, languagePath: string) => Promise<void>;
    saveConfig: () => void;

    // Rule Sets
    addRuleSet: (ruleSet: SCARuleSet) => void;
    updateRuleSet: (rulesetId: string, ruleSet: SCARuleSet) => void;
    deleteRuleSet: (rulesetId: string) => void;
    reorderRuleSets: (ruleSets: SCARuleSet[]) => void;

    // Individual Rules
    addRule: (rulesetId: string, rule: SCARule) => void;
    updateRule: (rulesetId: string, ruleId: string, rule: SCARule) => void;
    deleteRule: (rulesetId: string, ruleId: string) => void;
}

const defaultConfig: SCAConfig = {
    language_id: DEFAULT_LANGUAGE_ID,
    rule_sets: [],
};

let saveTimeout: ReturnType<typeof setTimeout>;

const debouncedSave = (projectPath: string, languagePath: string, config: SCAConfig) => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        try {
            await invoke('save_sca', { projectPath, languagePath, config });
        } catch (err) {
            console.warn(`SCA 配置保存失败：${err}`);
        }
    }, 500);
};

export const useSCAStore = create<SCAStore>((set, get) => ({
    config: defaultConfig,
    projectPath: '.',
    languagePath: 'proto_language',

    loadConfig: async (projectPath: string, languagePath: string) => {
        try {
            const config = await invoke<SCAConfig>('load_sca', { projectPath, languagePath });
            set({ config, projectPath, languagePath });
        } catch (err) {
            console.warn(`加载 SCA 配置失败：${err}`);
        }
    },

    saveConfig: () => {
        const { projectPath, languagePath, config } = get();
        debouncedSave(projectPath, languagePath, config);
    },

    // ── Rule Sets ──────────────────────────────────────────

    addRuleSet: (ruleSet) => {
        set((state) => ({
            config: { ...state.config, rule_sets: [...state.config.rule_sets, ruleSet] },
        }));
        get().saveConfig();
    },

    updateRuleSet: (rulesetId, ruleSet) => {
        set((state) => ({
            config: {
                ...state.config,
                rule_sets: state.config.rule_sets.map((rs) =>
                    rs.ruleset_id === rulesetId ? ruleSet : rs,
                ),
            },
        }));
        get().saveConfig();
    },

    deleteRuleSet: (rulesetId) => {
        set((state) => ({
            config: {
                ...state.config,
                rule_sets: state.config.rule_sets.filter((rs) => rs.ruleset_id !== rulesetId),
            },
        }));
        get().saveConfig();
    },

    reorderRuleSets: (ruleSets) => {
        set((state) => ({ config: { ...state.config, rule_sets: ruleSets } }));
        get().saveConfig();
    },

    // ── Individual Rules ───────────────────────────────────

    addRule: (rulesetId, rule) => {
        set((state) => ({
            config: {
                ...state.config,
                rule_sets: state.config.rule_sets.map((rs) =>
                    rs.ruleset_id === rulesetId
                        ? { ...rs, rules: [...rs.rules, rule] }
                        : rs,
                ),
            },
        }));
        get().saveConfig();
    },

    updateRule: (rulesetId, ruleId, rule) => {
        set((state) => ({
            config: {
                ...state.config,
                rule_sets: state.config.rule_sets.map((rs) =>
                    rs.ruleset_id === rulesetId
                        ? {
                            ...rs,
                            rules: rs.rules.map((r) => (r.rule_id === ruleId ? rule : r)),
                        }
                        : rs,
                ),
            },
        }));
        get().saveConfig();
    },

    deleteRule: (rulesetId, ruleId) => {
        set((state) => ({
            config: {
                ...state.config,
                rule_sets: state.config.rule_sets.map((rs) =>
                    rs.ruleset_id === rulesetId
                        ? { ...rs, rules: rs.rules.filter((r) => r.rule_id !== ruleId) }
                        : rs,
                ),
            },
        }));
        get().saveConfig();
    },
}));
