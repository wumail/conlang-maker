---
trigger: always_on
---

# Conlang Maker — AI Coding 开发规范

## 1. 技术栈约束

- 前端：React 18 + TypeScript (strict) + TailwindCSS v4 + DaisyUI v5 + Zustand + react-i18next + react-router-dom (HashRouter)
- 后端：Tauri v2 + Rust + serde + NDJSON 分桶存储
- 包管理器：bun
- 禁止引入新的状态管理库或 CSS 框架

## 2. TypeScript 严格性

- **禁止使用 `any`**。所有函数参数、返回值、泛型必须有明确类型。
- `invoke<T>()` 的泛型 T 必须指向 `src/types/index.ts` 中定义的接口。
- 使用 union literal type（如 `'SVO' | 'SOV'`）而非裸 `string`，除非值域确实不可穷举。
- 新增类型必须放在 `src/types/index.ts`，保持与 Rust `models.rs` 对照。

## 3. 组件规范

- **单个组件不超过 300 行**。超过时必须拆分为子组件。
- 组件文件结构：imports → 类型定义 → 常量 → 组件函数 → export。
- UI 样式类通过 `src/lib/ui.ts` 中的常量引用（INPUT, SELECT, TEXTAREA, BTN_PRIMARY 等），禁止在 JSX 中重复写 DaisyUI class 字符串。
- 页面级组件放 `src/pages/`，UI 组件放 `src/components/`。

## 4. 路由

- 使用 react-router-dom 的 `<NavLink>` / `<Route>` / `<Outlet>`。
- 禁止使用 `useState` 模拟页面切换（如 `activeTab === "xxx"`）。
- UI 导航状态完全由路由管理，不污染 Zustand Store。
- Tauri 环境使用 HashRouter，不使用 BrowserRouter。

## 5. 状态管理 (Zustand)

- Store 只存放**业务数据**（phonology config, words, grammar），不存放 UI 状态（active tab, modal open 等）。
- 每个 Store 的 debounce save 必须**以实体 ID 为粒度**（用 `Map<string, timeout>` 管理 timers），防止不同实体的保存互相取消。
- 批量操作（如导入多个词条）必须走独立的批量 command，不得循环调用单个 save。
- `addX` 和 `updateX` 语义相同时合并为一个 `upsertX` 方法。

## 6. 国际化 (i18n)

- **所有用户可见文本必须通过 `t()` 函数**，禁止在 JSX/工具函数中硬编码中文或英文。
- i18n key尽可能保持显式引用
- 新增翻译键时，必须同时更新 `en.ts` 和 `zh.ts`，保持键结构完全一致。
- 翻译键命名：`模块.区域.动作`，如 `phonology.presets.clearAll`。
- 执行 `npm run i18n:check` 确保翻译键完整且无多余。

## 7. 常量与魔法值

- 项目级常量（如 `DEFAULT_LANGUAGE_ID = 'lang_proto'`）统一放 `src/constants.ts`。
- DaisyUI class 常量统一放 `src/lib/ui.ts`。
- 禁止在多个文件中重复相同的字面量字符串。

## 8. Rust 后端

- **禁止 `unwrap()`**（除非 100% 确定不会 panic，如 static regex）。使用 `?` 操作符传播错误。
- Command 返回 `Result<T, String>` 以便前端 catch。
- 新增字段必须加 `#[serde(default)]` 保证向后兼容。
- 字段命名风格：Rust 用 snake_case，若前端需要不同名字用 `#[serde(rename)]`。

## 9. 文件组织

```
src/
  components/     # 可复用 UI 组件（<200行/文件）
    nav/          # 导航相关组件
  pages/          # 路由页面组件
  store/          # Zustand stores（纯业务状态）
  types/          # TypeScript 类型定义
  lib/            # 共享常量与工具类定义
  utils/          # 纯函数工具（无副作用）
  data/           # 静态数据（IPA 特征表、预设等）
  i18n/           # 翻译文件
  constants.ts    # 项目级常量
```

## 10. 代码质量红线

- `npx tsc --noEmit` 必须零错误。
- 禁止空 catch 块 `catch { }`，至少 `console.warn`。
- 禁止未使用的 import 和变量（tsconfig 已开启 `noUnusedLocals`）。
- 新增工具函数前，先搜索现有 `src/utils/` 是否已有同功能实现，避免重复。
- 删除功能时必须同步清理相关的翻译键、类型定义和 Store 方法。

## 11. 弹窗规范（Modal）

- 所有 DaisyUI 弹窗（`modal modal-open`）必须通过 `src/components/common/ModalPortal.tsx` 渲染到 `document.body`。
- 禁止在页面主布局树中直接挂载弹窗根节点，避免触发父容器（尤其是 ReactFlow / 图表容器）高度重算和布局抖动。
- 统一写法：`<ModalPortal open={open}>...</ModalPortal>`；`open=false` 时必须不渲染弹窗内容。
- 新增弹窗组件时，优先复用 `src/components/common/ConfirmModal.tsx` 或在组件内部接入 `ModalPortal`，避免重复实现 portal 逻辑。

## 12. 版本与发布规范

- 发布版本号必须在以下三个文件保持完全一致：
  - `package.json` 的 `version`
  - `src-tauri/Cargo.toml` 的 `[package].version`
  - `src-tauri/tauri.conf.json` 的 `version`
- 每次准备发布前必须执行：`bun run version:check`（CI 也会强制检查）。
- `identifier`（`src-tauri/tauri.conf.json`）在发布后**禁止随意修改**。修改会导致：
  - 被系统识别为不同应用（安装/更新链断裂）
  - 应用数据目录迁移问题（用户数据“丢失”）
- 仅在项目尚未正式发布或明确要做“新应用迁移”时，才允许调整 `identifier`。
