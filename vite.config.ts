import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// cspell:ignore languagedetector xyflow dagrejs dagre autotable Tauri tauri src-tauri
// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react()],

  // Disable Vite's built-in PostCSS processing to avoid conflicts with @tailwindcss/vite
  css: {
    postcss: {},
  },

  build: {
    target: "es2020",
    minify: "terser",
    cssMinify: true,
    sourcemap: false,
    reportCompressedSize: true,
    terserOptions: {
      compress: {
        passes: 2,
        drop_console: true,
        drop_debugger: true,
      },
      format: {
        comments: false,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          i18n: ["i18next", "react-i18next", "i18next-browser-languagedetector"],
          flow: ["@xyflow/react", "@dagrejs/dagre"],
          dnd: ["@dnd-kit/core", "@dnd-kit/sortable", "@dnd-kit/utilities"],
          markdown: ["react-markdown", "remark-gfm"],
          export: ["xlsx", "jspdf", "jspdf-autotable"],
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri` and data folders
      ignored: ["**/src-tauri/**", "**/proto_language/**"],
    },
  },
});
