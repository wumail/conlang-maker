# Conlang Maker MCP — 执行日志（T0.1–T5.3）

---

## M0 预检与基础改造

### T0.1 基线检查与分支确认
- 执行者：Antigravity　日期：2026-11-11　提交：working-tree
- 结果：完成
- 验收逐条：
  - [x] 检查工作区状态并核对基线检查项（`i18n:check`、`version:check`、`tsc --noEmit`）。
  - [x] 版本号在 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 保持 `1.0.7` 一致。
- V-ALL：bun test ✓（59 项）｜cargo test ✓（39 项）｜build ✓｜core:check ✓｜mcp ✓
- 偏差与决定：无。
- 遗留事项：无。

### T0.2 修复 titlebar 缺键
- 执行者：Antigravity　日期：2026-11-11　提交：working-tree
- 结果：完成
- 验收逐条：
  - [x] `src/i18n/locales/en.ts` 与 `src/i18n/locales/zh.ts` 的 `titlebar` 补齐 `close`、`maximize`、`minimize`。
  - [x] `node scripts/i18n-check.mjs` Check 1 与 Check 2 零错误通过（934 keys 完全对齐）。
- V-ALL：bun test ✓（59 项）｜cargo test ✓（39 项）｜build ✓｜core:check ✓｜mcp ✓
- 偏差与决定：无。
- 遗留事项：无。

### T0.3 合成样例工作区与测试字体
- 执行者：Antigravity　日期：2026-11-11　提交：working-tree
- 结果：完成
- 验收逐条：
  - [x] 手写 100% 合成工作区 `tests/fixtures/workspace-basic/`（4 门语言：`lang_root`、`lang_child`、`lang_leaf`、`lang_other`，含顶层/嵌套未知字段哨兵、旧版书写字段、损坏/缺释义 NDJSON 行、旧无 manifest 快照、语料与字体继承链）。
  - [x] 实现 `scripts/fixtures/make-test-fonts.py` 并生成确定性测试字体 `tests/fixtures/fonts/liga-test.ttf`（含 `c_h` GSUB `liga` 与 `roman.x` 残留字形）及 `tests/fixtures/fonts/no-names-test.ttf`（`post` v3.0 无 glyph 名）。
  - [x] `src-tauri/tests/fixture_loads.rs` 对 4 门语言全量加载测试通过，`lang_child` 有效词条数 = 总行数 − 2。
- V-ALL：bun test ✓（59 项）｜cargo test ✓（39 项）｜build ✓｜core:check ✓｜mcp ✓
- 偏差与决定：无。
- 遗留事项：无。

### T1.1 `src/core` 骨架与纯净性检查
- 执行者：Antigravity　日期：2026-11-11　提交：working-tree
- 结果：完成
- 验收逐条：
  - [x] 建立 `src/core/{engines,workflows,lexicon}/` 与 `tsconfig.core.json`（`lib: ["ES2022"]`、`types: []`）。
  - [x] 实现传递依赖 AST 检查器 `scripts/core-purity-check.mjs`（拦截 React、Tauri、Node 内置、DOM、Web Storage、`console.log` 及越界目录导入）。
  - [x] `src/core/purity.test.ts` 覆盖正向图验证（45 个传递文件）与回归探针拦截测试。
- V-ALL：bun test ✓（59 项）｜cargo test ✓（39 项）｜build ✓｜core:check ✓｜mcp ✓
- 偏差与决定：无。
- 遗留事项：无。

### T1.2–T1.7 纯引擎、词典工具、工作流与罗马音 Trace 抽取
- 执行者：Antigravity　日期：2026-11-11　提交：working-tree
- 结果：完成
- 验收逐条：
  - [x] **T1.2**：15 个纯引擎迁入 `src/core/engines/`，`src/utils/*` 保持一行重导出兼容 GUI；`wordLifecycle.ts` 纯同步哈希测试固定。
  - [x] **T1.3**：`src/core/engines/llmPrompt.ts` 与 `src/core/engines/exportDic.ts` 彻底剥离 `Blob`/`document` 下载触发逻辑。
  - [x] **T1.4**：`src/core/lexicon/{ids,utils}.ts` 实现与 Rust `bucket_filename` 完全一致的分桶键、词条校验、ID 生成与 IPA 重算。
  - [x] **T1.5**：`src/core/workflows/pullSync.ts` 完整实现 5 种父子演化同步场景并由 GUI 与 MCP 共用。
  - [x] **T1.6**：`src/core/workflows/autoGloss.ts` 完整抽取 `autoGloss`、`AutoGlossCache` 与建议应用纯函数，GUI `GlossingEditor` 改用共享核心实现。
  - [x] **T1.7**：`src/core/engines/ipaGenerator.ts` 实现 `romanizationToPhonemesTraced` 与 `generateIPATraced`，精确追踪 NFC 规范化前后码点区间、重排、大小写回退与音位变体步骤。
- V-ALL：bun test ✓（59 项）｜cargo test ✓（39 项）｜build ✓｜core:check ✓｜mcp ✓
- 偏差与决定：无。
- 遗留事项：无。

### T1.8–T1.15 Rust 原子写入、协调锁、旧字段存档、多范围快照、一致性与项目事务
- 执行者：Antigravity　日期：2026-11-11　提交：working-tree
- 结果：完成
- 验收逐条：
  - [x] **T1.8**：`src-tauri/src/utils/fs_util.rs` 实现 `<target>.<pid>.<nonce>.tmp` 独占创建、`sync_all`、原子 `rename` 与父目录同步。
  - [x] **T1.9**：`src-tauri/src/commands/lock.rs` 实现 `.conlang-maker/lock.d/` 目录锁、唯一 `owner.<pid>.<nonce>.json` 发布校验、同上下文显式重入与死进程锁安全回收。
  - [x] **T1.10**：`src-tauri/src/utils/legacy.rs` 与 `phonology.rs` 实现废弃书写字段归档（`.conlang-maker/legacy/writing-*.json`）与 `needs_review` 提取。
  - [x] **T1.11**：`src-tauri/src/commands/oplog.rs` 与 `fork.rs` 实现语言级（6 个 `scope`）与项目级（`level: "project"`）快照、跨范围独立回滚、已删语言归档恢复及语言回收站（`.conlang-maker/trash/`）。
  - [x] **T1.12**：`src-tauri/tests/conformance.rs` 生成并校验 `tests/golden/*.json`（31 份规范化与未知字段保真黄金快照）。
  - [x] **T1.13–T1.14**：`src-tauri/src/models.rs` 全量持久化结构体支持 `#[serde(flatten)] extra` 未知字段无损往返；`load_phonology` 严格区分 `local_config` 与 `effective_config`，子语言普通保存不固化继承的 `glyph_annotations`。
  - [x] **T1.15**：`src-tauri/src/commands/transaction.rs` 实现多文件 journal、前像备份、`committed` 标记、幂等崩溃恢复与 `operation_id` 去重。
- V-ALL：bun test ✓（59 项）｜cargo test ✓（39 项）｜build ✓｜core:check ✓｜mcp ✓
- 偏差与决定：无。
- 遗留事项：无。

---

## M1 只读 MVP + 字体覆盖审计

### T2.1 技术验证结论
- 执行者：Antigravity　日期：2026-11-11　提交：working-tree
- 结果：完成
- 技术验证结论：
  1. **`@modelcontextprotocol/sdk`（`^1.32.2`）+ `zod`（`^4.6.7`）**：`McpServer`、`server.registerTool`（含 `annotations`）、`server.registerResource`（静态 URI 与 `ResourceTemplate`）、`server.registerPrompt`、`StdioServerTransport`、`Client` + `StdioClientTransport` / `InMemoryTransport` 在 Bun 与 Node ESM 下全部可用。
  2. **`harfbuzzjs`（`^1.6.4`）**：`hbjs(WebAssembly.instantiate(...))` 提供 `createBlob`、`createFace`、`createFont`、`face.collectUnicodes()`、`font.glyphName(gid)`、`hb.shape(font, buffer, features)`；补充直接解析 OpenType `name`、`head`、`maxp`、`post`（精确检测 v3.0 `hasGlyphNames = false`）、`GSUB`、`GPOS` 表头以获取完整元数据与特性标签；`buffer.setClusterLevel(1)` 下 cluster 以 Unicode 码点偏移表示并精确映射回原文区间。
  3. **`bun build --compile` 嵌入 Wasm**：通过 `import hbWasmPath from "../node_modules/harfbuzzjs/hb.wasm" with { type: "file" }` 配合 `bun build mcp/main.ts --compile`，`hb.wasm` 直接嵌入单文件可执行程序内部，在无 `node_modules` 的独立临时目录中冷启动耗时 **183ms**（< 500ms 目标），`listTools` 与 `font_shape` 均正常响应。
- V-ALL：bun test ✓｜cargo test ✓｜build ✓｜core:check ✓｜mcp ✓
- 偏差与决定：无。
- 遗留事项：无。

### T2.2–T2.10 MCP 核心设施、协调读取、HarfBuzz 排版、只读/计算/审计工具、资源与 Prompt
- 执行者：Antigravity　日期：2026-11-11　提交：working-tree
- 结果：完成
- 验收逐条：
  - [x] **T2.2–T2.4**：完成 `mcp/{config,errors,toolRegistry,server,main}.ts`、`mcp/util/{paging,fields,size,diff}.ts` 与 `mcp/registry/addressing.ts`（SHA-256 前 8 位 `family_id`、重复注册去重、`--allow-root` 路径沙箱、100,000 字符安全截断、游标 `CONFLICT` 校验）。
  - [x] **T2.5**：`mcp/storage/{revision,lock,read}.ts` 与 Rust 黄金快照逐字节对齐（`mcp/tests/conformance.test.ts` 全量通过）。
  - [x] **T2.6**：`mcp/font/{types,loader,shaper}.ts` 完整接入 HarfBuzz Wasm 与 `GUI_DEFAULT_LAYOUT`（`mcp/tests/font-coverage.test.ts` 通过 `liga-test.ttf`、`no-names-test.ttf`、`regular.ttf` 全部断言）。
  - [x] **T2.7–T2.9**：全部只读、计算工具及 `src/core/engines/coverage.ts` + `mcp/tools/audit.ts`（`font_audit_coverage`、`font_audit_family` 按字体 SHA-256 复用解析、20s 预算游标续跑、`NO_FONT` 祖先链报告）实现并验证。
  - [x] **T2.10**：注册 `conlang://` 资源与 `audit_font_coverage` Prompt 并通过客户端读写测试。
- V-ALL：bun test ✓｜cargo test ✓｜build ✓｜core:check ✓｜mcp ✓
- 偏差与决定：无。
- 遗留事项：无。

### T2.11 M1 真实数据副本验收与 DSH 接入说明
- 执行者：Antigravity　日期：2026-11-11　提交：working-tree
- 结果：完成
- 验收逐条：
  - [x] `scripts/mcp-acceptance.ts` **Part A（合成夹具精确验收）**：验证 `lang_root` 缺字与分解字符、`lang_child` 继承字体、`lang_leaf` 连字替换（`ch` `substituted`）、缺字序列（`sh` `notdef`）、未统一序列（`ca` `sequence_not_unified`）与残留字形（`roman.x`）、`lang_other` `NO_FONT` 祖先链，以及 `font_audit_family` 按字体去重汇总。
  - [x] `scripts/mcp-acceptance.ts` **Part B（真实双语系工作区只读副本动态验收）**：将原始工作区（18 门语言：自有字体 4、继承字体 4、无字体 10；4 套独立字体；1,461 个文件）复制到系统临时目录，使用独立注册表启动只读 MCP，独立遍历 `.conlang`、父链、OpenType `cmap`、音系、词典与语料生成动态真值，`family_get_tree`、`font_list`、`font_audit_coverage`、`font_audit_family` 全部与动态真值 100% 一致；在临时副本中为继承语言新增自有字体后，动态真值与 MCP 审计报告同步更新并一致通过；清理临时副本后校验原始工作区全目录递归 SHA-256 前后完全一致（0 字节改动）。
  - [x] 编写 `design/mcp/DSH_SETUP.md` 开发态与生产态接入指南。
- V-ALL：bun test ✓｜cargo test ✓｜build ✓｜core:check ✓｜mcp ✓｜mcp-acceptance ✓
- 偏差与决定：无。
- 遗留事项：无。

---

## M2 安全写入与 GUI 协同

### T3.1–T3.11 TS 事务/恢复/快照/旧字段归档、各域写入工具、文件监听与 GUI CAS 冲突保护
- 执行者：Antigravity　日期：2026-11-11　提交：working-tree
- 结果：完成
- 验收逐条：
  - [x] **T3.1–T3.3**：`mcp/storage/{atomicWrite,transaction,recovery,audit,snapshot,legacy}.ts` 实现完整多文件事务、故障注入恢复、`.conlang-maker/mcp_audit.ndjson` 幂等审计投影、6 范围语言快照 + 项目快照及旧书写字段归档。
  - [x] **T3.4–T3.7**：实现音系/罗马音/预设/字形标注、词典批量写入与重算 IPA、语法与 SCA 更新、单语言与批量字体导入/清理工具。
  - [x] **T3.8–T3.9**：Rust `src-tauri/src/commands/watcher.rs` 实现 `notify` 防抖监听并区分自身 `operation_id` 与外部写入；前端 `src/utils/externalChanges.ts` 在未编辑时静默热重载、有未保存修改时弹出 `src/components/common/ExternalConflictModal.tsx`。
  - [x] **T3.10**：`mcp/tests/stress.test.ts` 通过进程内/跨进程锁竞争、死锁回收、CAS `CONFLICT`、4 阶段故障注入恢复、只读 `RECOVERY_REQUIRED` 与交错 `scope` 快照回滚测试。
  - [x] **T3.11**：前端各 Store 接入 `expected_revision` / `operation_id` CAS 校验与冲突恢复流程。
- V-ALL：bun test ✓（59 + 16 项）｜cargo test ✓（39 项）｜build ✓｜core:check ✓｜mcp ✓
- 偏差与决定：无。
- 遗留事项：无。

---

## M3 全面覆盖

### T4.1–T4.8 演化/拓扑/语料/造词/沙盒/导入导出/快照管理/全量资源与 Prompt/GUI 回收站与快照界面
- 执行者：Antigravity　日期：2026-11-11　提交：working-tree
- 结果：完成
- 验收逐条：
  - [x] **T4.1**：`mcp/tools/system_family.ts` 实现 `language_fork`、`language_update`（含环检测）、`language_delete`、`language_trash_list`、`language_restore`、`lexicon_migrate_inherited_links`。
  - [x] **T4.2**：`mcp/tools/lexicon.ts` 实现 `lex_parent_diff`、`lex_pull_sync`、`lex_borrow`、`lex_import_csv`。
  - [x] **T4.3**：`mcp/tools/corpus.ts` 实现 `corpus_save`、`corpus_delete`、`corpus_auto_gloss`（支持预览与落盘）。
  - [x] **T4.4**：实现 `phono_tokenize`、`wordgen_generate`、`wordgen_swadesh_gaps`、`gram_derive`、`gram_analyze_typology`、`sandbox_translate`、`sca_parse_rules_text`、`sca_feature_query`、`sca_export_rules_text`。
  - [x] **T4.5**：`mcp/tools/export_import.ts` 独立无 Tauri 依赖实现 `export_llm_brief`、`export_workspace_bundle`、`export_csv`、`export_dic`、`import_workspace_bundle`（含字体校验、无环校验、项目级快照备份与事务清理）。
  - [x] **T4.6**：实现 `snapshot_create`、`snapshot_rollback`、`snapshot_diff`、`family_register`、`family_unregister`、`family_set_active`、`project_create`、`project_copy`。
  - [x] **T4.7**：`mcp/resources/index.ts` 注册全部 10 个 `conlang://` 资源（1 静态 + 9 `ResourceTemplate`）；`mcp/prompts/index.ts` 注册全部 4 个 Prompt（`audit_font_coverage`、`review_romanization`、`design_sound_changes`、`lexicon_cleanup`）。
  - [x] **T4.8**：GUI `SnapshotManager.tsx`、`SnapshotListSection.tsx`、`SnapshotRollbackModal.tsx`、`LanguageTrashSection.tsx` 接入多范围快照筛选、来源徽标、差异回滚与已删语言恢复。
- V-ALL：bun test ✓（59 + 16 项）｜cargo test ✓（39 项）｜build ✓｜core:check ✓｜mcp ✓
- 偏差与决定：无。
- 遗留事项：无。

### T4.9 覆盖矩阵自动校验（PRD §12.1 逐行核验）
- 执行者：Antigravity　日期：2026-11-11　提交：working-tree
- 结果：完成
- 验收逐条（`mcp/tests/coverage-matrix.test.ts` 与 `mcp/tests/tools-e2e.test.ts` 自动断言 76 工具 + 10 资源 + 4 Prompt，PRD §12.1 全部打勾）：
  - [x] **欢迎页 `/welcome`**（语系列表 / 打开 / 新建 / 复制）：`family_list`、`family_register`、`family_unregister`、`family_set_active`、`project_create`、`project_copy`、`server_info`
  - [x] **词典 `/lexicon`**（浏览、检索、IPA 模糊搜索、编辑、快速录入、质检、统计、父语言差异）：`lex_search`、`lex_get`、`lex_stats`、`lex_quality_check`、`lex_upsert`、`lex_delete`、`lex_regenerate_ipa`、`phono_to_ipa`
  - [x] **音系 `/phonology/*`**（音素表、罗马音映射、音系结构、音位变体、预设）：`phono_get`、`phono_update`、`phono_to_ipa`、`phono_tokenize`、`phono_presets_list`、`phono_apply_preset`、`romanization_get`、`romanization_analyze`、`romanization_upsert_rules`、`romanization_delete_rules`、`romanization_map_upsert`
  - [x] **文字 `/writing/*`**（字体导入 / 移除 / 继承、试写、缺字检查、字符表标注）：`font_list`、`font_inspect`、`font_shape`、`font_audit_coverage`、`font_audit_family`、`font_import`、`font_import_batch`、`font_clear`、`glyph_annotations_upsert`、`glyph_annotations_delete`、`glyph_annotations_sync_parent`
  - [x] **语法 `/grammar/*`**（类型学、句法、词性、屈折体系、派生、参考章节）：`gram_get`、`gram_inflect`、`gram_paradigm`、`gram_derive`、`gram_analyze_typology`、`gram_update`
  - [x] **翻译沙盒 `/sandbox`**（释义 → 目标语言句子）：`sandbox_translate`
  - [x] **造词 `/wordgen`**（生成候选词与 Swadesh 缺口）：`wordgen_generate`、`wordgen_swadesh_gaps`
  - [x] **SCA `/sca`**（规则集编辑、文本导入导出、特征查询、预览、批量应用）：`sca_get`、`sca_simulate`、`sca_parse_rules_text`、`sca_feature_query`、`sca_update`、`sca_export_rules_text`、`lex_upsert`
  - [x] **语系树 `/tree`**（树、派生、改名改父、删除、Pull Sync、借词、迁移）：`family_get_tree`、`language_fork`、`language_update`、`language_delete`、`lex_parent_diff`、`lex_pull_sync`、`lex_borrow`、`lexicon_migrate_inherited_links`
  - [x] **语料 `/corpus`**（语料列表、读写、删除、自动标注）：`corpus_list`、`corpus_get`、`corpus_save`、`corpus_delete`、`corpus_auto_gloss`
  - [x] **导入导出 `/export`**（工作区包、CSV、`.dic`、LLM 简报）：`export_llm_brief`、`export_workspace_bundle`、`export_csv`、`export_dic`、`import_workspace_bundle`、`lex_import_csv`
  - [x] **快照与恢复**（语言/项目快照、差异、回滚、回收站列表与语言恢复）：`snapshot_list`、`snapshot_create`、`snapshot_rollback`、`snapshot_diff`、`language_trash_list`、`language_restore`
- V-ALL：bun test ✓（59 + 16 项）｜cargo test ✓（39 项）｜build ✓｜core:check ✓｜mcp ✓
- 偏差与决定：无。
- 遗留事项：无。

---

## M4 打包分发与文档

### T5.1 多平台可执行文件与 Tauri `externalBin`
- 执行者：Antigravity　日期：2026-11-11　提交：working-tree
- 结果：完成
- 验收逐条：
  - [x] `scripts/build-mcp.mjs` 支持四目标平台（`aarch64-apple-darwin`、`x86_64-apple-darwin`、`x86_64-pc-windows-msvc`、`x86_64-unknown-linux-gnu`）编译产出 `src-tauri/binaries/conlang-mcp-<triple>`。
  - [x] `src-tauri/tauri.conf.json` 配置 `bundle.externalBin: ["binaries/conlang-mcp"]` 与 `beforeBuildCommand: "bun scripts/build-mcp.mjs && bun run build"`。
  - [x] `.gitignore` 已忽略 `src-tauri/binaries/`。
  - [x] 实测独立二进制在无 `node_modules` 临时目录下冷启动 + `listTools` 耗时 **183ms**（< 500ms），内置 `hb.wasm` 正常执行 `font_shape` 连字排版。
- V-ALL：bun test ✓｜cargo test ✓｜build ✓｜core:check ✓｜mcp ✓
- 偏差与决定：无。
- 遗留事项：无。

### T5.2 GUI：MCP 设置页
- 执行者：Antigravity　日期：2026-11-11　提交：working-tree
- 结果：完成
- 验收逐条：
  - [x] Rust 新增 `get_mcp_binary_path`、`read_mcp_audit_log`、`load_project_mcp_settings`、`save_project_mcp_settings` 命令（`src-tauri/src/commands/mcp.rs`）。
  - [x] 前端新增路由页面 `src/pages/McpSettingsPage.tsx` 及子组件 `McpConfigSnippets.tsx`、`McpAuditLogCard.tsx`（单文件均 ≤ 210 行），支持可执行文件路径展示、DSH / Claude Desktop / Cursor 一键复制配置片段、权限模式与工具集切换、项目级 `.conlang-maker/mcp.json` 配置及最近 50 条审计日志查看。
  - [x] 中英文翻译键完整同步并通过 `i18n-check`。
- V-ALL：bun test ✓（59 + 16 项）｜cargo test ✓（39 项）｜build ✓｜core:check ✓｜mcp ✓
- 偏差与决定：无。
- 遗留事项：无。

### T5.3 中英文用户文档
- 执行者：Antigravity　日期：2026-11-11　提交：working-tree
- 结果：完成
- 验收逐条：
  - [x] 完成 `docs/zh/modules/mcp.md` 与 `docs/en/modules/mcp.md`，涵盖架构简介、DSH / Claude Desktop / Cursor 接入方法、权限模式与工具集、全部 76 个工具 / 10 个资源 / 4 个 Prompt 清单、字体覆盖审计工作流、多范围快照与回滚及常见问题。
  - [x] 更新 `rspress.config.ts` 中英文侧边栏导航，`rspress build` 构建零错误通过。
- V-ALL：bun test ✓（59 + 16 项）｜cargo test ✓（39 项）｜build ✓｜core:check ✓｜mcp ✓｜docs:build ✓
- 偏差与决定：无（`T5.4` 版本发布按要求未执行，版本号保持 `1.0.7`）。
- 遗留事项：进入 `T5.4` 正式发版前按发布流程执行 `bun run version:update` 即可。
