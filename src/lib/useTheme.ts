import { useCallback, useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'conlang-maker-theme';

function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light') return v;
  } catch { /* SSR / sandboxed */ }
  return 'light';
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

// Simple external store so every consumer stays in sync
let currentTheme: Theme = getStoredTheme();
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): Theme {
  return currentTheme;
}

function setTheme(theme: Theme) {
  currentTheme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
  listeners.forEach((cb) => cb());
}

// Apply theme on module load
applyTheme(currentTheme);

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot);
  const toggle = useCallback(() => {
    setTheme(currentTheme === 'light' ? 'dark' : 'light');
  }, []);
  return { theme, toggle, setTheme } as const;
}
