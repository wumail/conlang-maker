# Conlang Maker 核心产品力跃升 · 执行进度与终审复核对照表（EXECUTION LOG）

| 项目 | 内容 |
| --- | --- |
| 关联规格文档 | [PRD.md](./PRD.md) v1.0 |
| 关联执行计划 | [EXECUTION_PLAN.md](./EXECUTION_PLAN.md) v1.0 |
| 当前状态 | 执行中（7 / 20 已完成） |
| 执行模型 | DeepSeek v4.1 Flash（或开发者） |
| 终审复核者 | Antigravity |

---

## 1. P0–P3 全景完成度与双盲复核总表（Master Sign-off Checklist）

> **填写说明**：
> - **执行者（DeepSeek）**：每完成一个任务并跑通 `V-ALL` 全部 8 条门禁命令后，将该行「执行状态」改为 `[x]`，填入提交哈希（或 `working-tree`）与测试计数摘要，并在 **§3 逐任务执行日志** 填写完整验收记录。
> - **终审者（Antigravity）**：严禁仅凭勾选采信；必须独立运行 **§2 终审十项自动化核验命令** 并逐文件抽查代码与边界单测，全部达标后方可勾选「Antigravity 终审通过」。

| 任务 ID | 梯度 | 任务摘要 | 对应 PRD | 执行状态 | 日期 / Commit | `V-ALL` 结果 | Antigravity 终审通过 | 终审备注 |
| :---: | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **T0.1** | P0 | CI 全量门禁接入与僵尸翻译键清零 | §2.1 | [x] | 2026-11-12 / `e28b5bd` | 8/8 全绿（135 项单测：src 83 + mcp 34 + cargo 46 − 计数见 §3） | [ ] | |
| **T0.2** | P0 | DP+最大声母音节切分器与 10 维词典质检引擎 | §2.2 | [x] | 2026-11-12 / `30a4ad0` | 8/8 全绿（src 120 pass / mcp 34 pass / cargo 47 pass） | [ ] | |
| **T0.3** | P0 | 罗马化静态诊断实时上屏 | §2.2 | [x] | 2026-11-12 / `bcc4e3b` | 8/8 全绿（src 120 pass） | [ ] | |
| **T0.4** | P0 | 谱系词库缓存层与动态高度虚拟列表接入 | §2.3 | [x] | 2026-11-12 / `4641c2d` | 8/8 全绿（src 126 pass / mcp 34 / cargo 47） | [ ] | |
| **T0.5** | P0 | 四大超长组件解耦拆分（回归 ≤300 行红线） | §2.3 | [x] | 2026-11-12 / `00baaf9` | 8/8 全绿（src 126 pass） | [ ] | |
| **T1.1** | P1 | 零依赖跨 Store 命令合并型 Undo/Redo 引擎 | §3.1 | [x] | 2026-11-12 / `3583dda` | 8/8 全绿（src 137 pass） | [ ] | |
| **T1.2** | P1 | 语料反向索引引擎与词典详情三大内联卡片 | §3.2 | [x] | 2026-11-13 / `d5fa1fb` | 8/8 全绿（src 146 pass / mcp 39 pass / cargo 47） | [ ] | |
| **T1.3** | P1 | 语料三行标注侧边快建词条抽屉 | §3.2 | [ ] | — | — | [ ] | |
| **T1.4** | P1 | 全局 `Cmd+K` 跨语系检索与即时沙盒演算面板 | §3.3 | [ ] | — | — | [ ] | |
| **T1.5** | P1 | 单行语言学规则 DSL ↔ 表单双向无损编辑器 | §3.4 | [ ] | — | — | [ ] | |
| **T2.1** | P2 | P2 向后兼容持久化 Schema 同步扩展 | §4.1–4.3 | [ ] | — | — | [ ] | |
| **T2.2** | P2 | CLDF/Concepticon 概念库、词义绑定与旧标签迁移 | §4.1 | [ ] | — | — | [ ] | |
| **T2.3** | P2 | 全语系同源词矩阵引擎与虚拟化对照表视图 | §4.1 | [ ] | — | — | [ ] | |
| **T2.4** | P2 | DAG 多词素构词图谱、词族树与过期复合词质检 | §4.2 | [ ] | — | — | [ ] | |
| **T2.5** | P2 | 共时形态音位层（`+` 边界）、多模式重音与超音段 SCA | §4.3 | [ ] | — | — | [ ] | |
| **T2.6** | P2 | 历时语法词缀演化同步与同音中和（Syncretism）预警 | §4.4 | [ ] | — | — | [ ] | |
| **T3.1** | P3 | HarfBuzz WASM 字形几何与排版度量审计纯引擎 | §5.1 | [ ] | — | — | [ ] | |
| **T3.2** | P3 | 书写系统可视化基准线叠加层与异常字形诊断面板 | §5.1 | [ ] | — | — | [ ] | |
| **T3.3** | P3 | 递归短语结构树与格对齐（Nom-Acc / Erg-Abs）句法台 | §5.2 | [ ] | — | — | [ ] | |
| **T3.4** | P3 | 出版级《参考语法与双向词典》单文件 HTML/矢量打印与 Typst 导出 | §5.3 | [ ] | — | — | [ ] | |

---

## 2. Antigravity 终审十项红线一键核验清单（Post-Execution Audit Protocol）

当全部或分阶段任务移交回 Antigravity 验收时，依次执行以下 10 项客观硬核查（任一项失败即打回修复）：

1. **全量编译与单测门禁（`V-ALL`）**：
   - `node scripts/i18n-check.mjs`（0 缺键、0 多余键、0 未使用僵尸键）
   - `node scripts/version-check.mjs`（三处版本号一致且 `tauri.conf.json` `identifier` 未被篡改）
   - `bun run core:check`（`src/core` 零 React/DOM/Tauri/NodeFS 污染）
   - `bunx tsc --noEmit` & `bun run mcp:check`（零 TypeScript 类型错误）
   - `bun test src` & `bun run mcp:test` & `cargo test --manifest-path src-tauri/Cargo.toml`（全绿通过）
2. **黄金快照零破坏审计**：
   - 检查 `git diff tests/golden/` 必须为空（证明旧工作区反序列化/重序列化 100% 字节无损向后兼容）。
3. **组件 300 行红线扫描**：
   - 检查 `src/components/**/*.tsx` 与 `src/pages/**/*.tsx` 中所有本次新建或修改的组件文件 `wc -l <= 300`。
4. **TypeScript `any` 与空 `catch` 扫描**：
   - 在 `src/` 与 `mcp/` 中搜索 `: any`、`as any`、`<any>` 及空 `catch {}`，命中数必须为 `0`。
5. **Rust 生产代码 `.unwrap()` 扫描**：
   - 检查 `src-tauri/src/` 非 `#[cfg(test)]` 区域不存在裸 `.unwrap()`。
6. **弹窗规范（ModalPortal）扫描**：
   - 检查所有含 `modal-open` 的新建弹窗/抽屉是否 100% 经过 `ModalPortal.tsx` 挂载。
7. **虚拟列表防抖动样式核查**：
   - 检查所有 `virtualizer.measureElement` 节点不存在写死的 `height` 或外层 `margin` 样式。
8. **Undo/Redo 引用隔离与防抖落盘核查**：
   - 检查 `undo` / `redo` 闭包是否深拷贝快照（`structuredClone`），且回放时传入 `{ skipHistory: true }` 正常触发磁盘保存。
9. **MCP 工具同步契约核查**：
   - 核对 `EXPECTED_76_TOOLS` 包含全部 83 个工具（原 76 + 新增 7），注解 `readOnlyHint` / `destructiveHint` 准确无误。
10. **用户真实数据零触碰核查**：
    - 确认仓库内未混入任何外部真实工作区数据，外部设定目录未被写入。

---

## 3. 逐任务执行日志（执行者在此按序追加/填写）

### P0 地基加固阶段

#### T0.1 CI 全量门禁接入与僵尸翻译键清零
- 执行者：DeepSeek v4.1 Flash　日期：2026-11-12　提交：`e28b5bd`
- 结果：✅ 完成
- 验收逐条：
  - [x] `.github/workflows/ci.yml` 接入全部 8 条检查与测试命令（`i18n-check` → `version-check` → `core:check` → `tsc --noEmit` → `bun test src` → `mcp:check` → `mcp:test` → `cargo test`），并在 Rust 步骤前新增 `bun run mcp:build`（Tauri `externalBin` sidecar 缺失会让 `cargo test` 的 build script 直接失败）。
  - [x] `node scripts/i18n-check.mjs` → `0 errors, zero warnings`。
- 关键实现：
  1. `scripts/i18n-check.mjs`：Check 1/2 的失败改为 `exit 1`（原实现即使有缺键也 `exit 0`，门禁形同虚设）；间接引用正则扩展为 `key|labelKey|nameKey|descriptionKey`，覆盖 `src/data/phonology_presets.ts` 这类静态数据表的显式 key 引用。
  2. 新增 `src/lib/labelMaps.ts`（177 行）：把 10 个「模板字符串动态 key」家族收敛为 `Record<string, string>` 显式映射 Hook —— IPA 元音高度(7)/调音部位(12)/发音方式(13)/气流分类(6)/协同调音子类(6)、类型学形态类型(4)/说明(4)/核心标记(4)、屈折类型(2)、质检规则(6)。
  3. 改造 7 个消费组件：`ConsonantCharts`、`VowelChart`、`TypologySection`、`WordGenerator`、`InflectionSection`、`QualityCheck`、`PullSync`（`t(cond ? "a" : "b")` 三元改为两个显式 `t()` 调用）。
  4. 删除 47 个确无引用的僵尸键（`en.ts` / `zh.ts` 同步）：`common.{addToken,collapse,expand,run,select}`、`grammar.{posTitle,syntaxTitle,testTitle,derivation.title}`、`lexicon.{newWord,sortDefault,posList.*}`、`nav.qc`、`phonology.{allophony.title,romanization.title,romanization.inventory,phonotactics.title,phonotactics.addPhoneme,phonotactics.selectPhoneme,inventory.places.Palatal,inventory.subcategories.{lateralAffricate,lateralFricative,nasal,none}}`、`sca.{batchApply,changedCount,showingFirst}`、`tree.{borrowWord,importProject,rollbackConfirm,rollbackTitle,snapshotWarning}`、`typology.title`、`wordgen.{addTags,advancedSearch,batchEdit,noChange,removeTags,setPosAll,typologyHint}`。
- V-ALL：`[exit 0] × 8` — i18n 0/0、version 1.0.7 一致、core purity 32 文件通过、tsc 0 error、`bun test src` 83 pass、`mcp:check` 0 error、`mcp:test` 34 pass、`cargo test` 46 + 1 conformance 全绿。
- 偏差与决定：
  1. **基线修复（必要前置）**：开工时仓库并非全绿 —— `mcp:check` / `mcp:test` 因 `node_modules` 缺 `@types/bun`、`@modelcontextprotocol/sdk` 而失败（执行 `bun install` 解决）；`cargo test` 因本机 `MacOSX27.0.sdk` 的 `libSystem.B.tbd` 与 clang 21 不兼容而链接失败（以 `SDKROOT=MacOSX26.5.sdk` 运行，未修改仓库配置）；`conformance` 因上一提交给 `FontInspection` 新增的两个 `Vec<String>` 字段未做序列化约束而与 `tests/golden/font_inspect_*.json` 不一致。按「严禁修改 golden」红线，改为在 `font.rs` 上对这两个字段标注 `#[serde(skip_serializing)]`（GUI/MCP 均未消费，特性检测仍由 `FontFaceInfo` 完整保留），golden 零字节差异恢复。
  2. **额外组件拆分**：`WordGenerator.tsx`(357) 与 `InflectionSection.tsx`(382) 本就在 300 行红线上，但本任务必须改动其中的动态 key。为满足「修改的 .tsx 必须 ≤ 300 行」，按职责抽出 `RewriteSettingsPanel.tsx`(123) 与 `InflectionRuleFields.tsx`(173)，交互与状态归属不变。
  3. `mcp:test` 的 `T3.10 1b cross-process lock` 在同一秒内并发跑 cargo/tsc 时偶发失败（子进程 spawn 时序），单独运行与常规重跑均 100% 通过，未改动该测试。

#### T0.2 DP + 最大声母音节切分器与 10 维词典质检引擎
- 执行者：DeepSeek v4.1 Flash　日期：2026-11-12　提交：`30a4ad0`
- 结果：✅ 完成
- 验收逐条：
  - [x] `src/core/engines/syllabifier.ts`（287 行）实现槽位编译、DP 切分、最大声母消歧与音重计算。
  - [x] `qualityCheck.ts`（317 行）升级 `unmappedSpelling` 并新增 4 类音系/同音质检，37 条单测全覆盖。
- 关键实现：
  1. `compileSyllableUnits`：把模板直接编译为 `SlotUnit { allowed, optional, role }[]`，同时支持 `(C)(L)V(N)` 与 `C?VC?`，**不做 2^k 字符串展开**；未定义宏回退 `C`/`V` → inventory，其余按字面量槽位。角色分类为 onset / nucleus / coda（首个可容纳元音的槽位起算，连续元音槽位并入 nucleus）。
  2. `syllabifyWithUnits`：DP 在 `string[]` token 下标上推进（`tʃ`/`kʰ`/`aː` 全程保持单一元素，绝不 `join("")`），`isBetterPlan` 先比音节数、再从 k=1 起比 `onset.length`（最大声母），失败时回填 `failedAtTokenIndex`。
  3. `unmappedSpelling` 改走 `romanizationToPhonemesTraced().segments`，仅当 `rule_id === null` 且非空白/非已知标点时上报，彻底消除多合字母的字符级漏检与假阳性。
  4. 新增规则：`phonotacticViolation`（error，消息带卡住的音素下标）、`blacklistHit`（error，复用导出的 `matchesBlacklist`）、`vowelHarmonyViolation`（warning，同一词根混用 group_a/group_b）、`homophonyClash`（warning，表层 IPA + pos_id 分组，≥2 个不同 entry 才报）。
  5. 性能：每词只调用一次 `generateIPATraced`，同时服务 4 条依赖发音的规则；`QC_RULE_KEYS` 成为 GUI / MCP 唯一规则清单（`mcp/tools/lexicon.ts` 删除本地重复数组，zod enum 直接引用）。
- V-ALL：`[exit 0] × 8` — i18n 0 错误 0 告警、tsc 0 error、`bun test src` 120 pass（新增 37）、`mcp:check` 0 error、`mcp:test` 34 pass（`lex_quality_check` 未改签名即自动透出新规则）、`cargo test` 47 pass。
- 偏差与决定：
  1. IPA 输出带 `/.../` 与 `[...]` 包裹，剥离超音段时一并去除，否则 tokenize 会把斜杠当成音素导致全量误报（已在实现与单测中固化）。
  2. 无默认罗马化映射（或规则为空）时跳过 `phonotacticViolation`/`vowelHarmonyViolation` 的发音侧推断，避免把「尚未配置音系」的新工作区全量标红。

#### T0.3 罗马化静态诊断实时上屏
- 执行者：DeepSeek v4.1 Flash　日期：2026-11-12　提交：`bcc4e3b`
- 结果：✅ 完成
- 验收逐条：
  - [x] `RomanizationLintBanner.tsx`（158 行）实时展示死规则、不可达音素、越界音素并在行内标黄。
  - [x] 涉及组件均 ≤ 300 行（Editor 205 / RuleTable 170 / Banner 158），无硬编码文案。
- 关键实现：
  1. 编辑器用 `useMemo(() => analyzeRomanization(config, { mapScope: "all" }), [config])` 实时重算 6 类静态诊断；`buildRuleLintIndex()` 把结果压缩成 `Map<rule_id, count>`。
  2. 诊断条健康态只显示一行绿色 `CheckCircle2` 徽章；异常态折叠条展示 6 类计数 chip，展开后分组列出「被 `A` 遮蔽的 `B`」「不可达音素 /…/」「规则输出越界」与冲突/重复/大小写汇总。
  3. `RuleTable` 每行按 `rule_id` 命中索引时渲染 `AlertTriangle` 黄标，`title` 显示该规则诊断条数。
- V-ALL：`[exit 0] × 8`（i18n 0/0，tsc 0 error，src 120 pass，mcp 34 pass，cargo 47 pass）。
- 偏差与决定：诊断范围取 `mapScope: "all"` 而非仅默认映射表——编辑器同时展示多张映射表，仅分析默认表会让其余表出现「无诊断」的误导性绿灯。

#### T0.4 谱系词库缓存层与动态高度虚拟列表接入
- 执行者：DeepSeek v4.1 Flash　日期：2026-11-12　提交：`4641c2d`
- 结果：✅ 完成
- 验收逐条：
  - [x] `lineageLexiconStore.ts`（258 行）实现父语言词表请求去重与按 `revision` 失效。
  - [x] 词典侧边栏、SCA 批量预览、质检列表接入 `useVirtualizer` 且无固定行高重叠。
- 关键实现：
  1. 缓存键 `${projectPath}::${languagePath}`，记录 `{ snapshot, loadingPromise, error, lastSnapshot }`；`loadLineageLexicon` 并发去重（同键复用同一 Promise），`revision` 未变时复用旧快照对象引用，`useSyncExternalStore` 订阅版本号（未引入新状态库）。
  2. 失效钩子：`externalChanges` 在 lexicon / phonology / workspace / snapshots 事件上精准失效；`workspaceStore.loadWorkspace` 切换项目时清空旧项目缓存，`clearWorkspace` 全清。
  3. 虚拟列表严格照抄 §7.2-A 模板：外层滚动容器 `overflow-y-auto contain-strict`，行容器只写 `position/top/left/width/transform` + `ref={measureElement}` + `data-index`，行距由内层 `pb-1.5`／`pb-1` 承担。
  4. SCA 批量预览删除 100 条/页硬分页（连带删除 `sca.{prevPage,nextPage,pageInfo}` 三个废弃键），改为 `max-h-96` 全量虚拟滚动。
  5. `Sidebar`/`EditorPane` 不再各自 `invoke("load_all_words")`：父语言走 `useLineageLexicon`，祖先链用 `loadLineageLexicon` + 缓存读取（`useLineageLexiconCacheVersion` 触发重算）。
- V-ALL：`[exit 0] × 8`（i18n 0/0；tsc 0 error；src 126 pass 含新增 6 条缓存层单测；mcp 34；cargo 47）。
- 偏差与决定：
  1. **T0.4/T0.5 合并执行**：`Sidebar`(688)/`EditorPane`(691)/`SCAPreview`(559) 本就超过 300 行，而本任务必须改动它们；为同时满足「修改的 .tsx ≤ 300 行」与「禁止越界重构」，在接入虚拟列表的同时按 T0.5 规定的边界完成拆分（`LexiconFilterBar`/`LexiconVirtualList`/`WordHeaderSection`/`WordSensesSection`/`WordEtymologySection`/`SCASingleTester`/`SCABatchVirtualPreview`），T0.5 因此只剩 `RuleSetList` 拆分与全仓行数复核。
  2. 抽取 `src/utils/scaPreviewPatch.ts`：原 `SCAPreview` 内两份近 100 行的 `patchXxxRuleWithSCA` 合并为一个泛型 `patchRuleWithSca` + 字段描述表，行为与原实现逐字段等价（affix/infix/circumfix×2/ablaut×2），同时消除重复代码。
  3. 抽取 `src/utils/lexiconDraft.ts`：`isDraftWord` / `createDraftWord` 供 Sidebar 复用，顺带删除已被注释掉的「清理空词条」死代码与其 2 个翻译键（`lexicon.cleanBlankWords*`），以及随 TTS 注释一起失效的 `lexicon.playTts`。

#### T0.5 四大超长组件解耦拆分（回归 ≤300 行红线）
- 执行者：DeepSeek v4.1 Flash　日期：2026-11-12　提交：`00baaf9`（Sidebar / EditorPane / SCAPreview 见 `4641c2d`）
- 结果：✅ 完成
- 验收逐条：
  - [x] `Sidebar.tsx`(278)、`EditorPane.tsx`(279)、`RuleSetList.tsx`(298)、`SCAPreview.tsx`(165) 及其全部拆分子组件行数严格 `≤ 300`。
- 行数实测（`wc -l src/components/lexicon/*.tsx src/components/sca/*.tsx`，最大项）：
  - lexicon：`Statistics`288（既有）、`EditorPane`279、`Sidebar`278、`LexiconFilterBar`246、`QualityCheck`179、`WordEtymologySection`178、`LexiconVirtualList`166、`WordHeaderSection`119、`WordSensesSection`109；
  - sca：`RuleSetList`298、`FeatureSelector`175（既有）、`SCAPreview`165、`SCARuleEditorRow`113、`SCABatchVirtualPreview`112、`SCARuleCard`97、`SCASingleTester`71、`SCARuleSetImportModal`84、`SCARuleSetToolbar`49。
- 关键实现：
  1. `RuleSetList` 拆为容器（状态 + Store 写入 + 导入解析）+ `SCARuleSetToolbar`（页头三按钮与转移提示）+ `SCARuleCard`（规则集折叠头）+ `SCARuleEditorRow`（单规则双形态编辑）+ `SCARuleSetImportModal`（经 `ModalPortal` 的导入弹窗）。
  2. 抽出 `src/utils/scaRuleSetTransfer.ts`：`serializeRuleSet` / `serializeAllRuleSets` / `safeRuleSetFileName` / `downloadTextFile` / `copyTextToClipboard`，把 DOM 与剪贴板细节移出组件。
  3. 交互与快捷键行为保持不变：折叠集合、删除二次确认、解析错误逐行提示、复制/下载成功提示 2.4s 自动消失。
- V-ALL：`[exit 0] × 8`（i18n 0/0；tsc 0 error；src 126 pass；mcp 34；cargo 47）。
- 偏差与决定：全仓扫描仍有 6 个「本轮未触碰」的既有超长文件（`McpSettingsPage`429、`DerivationEditor`417、`Sandbox`390、`FamilyManager`380、`ExportImport`339、`FontPanel`326）。它们不属于 T0.5 目标文件、本轮也未修改，故不在本任务内拆分；其中 `Sandbox`（T3.3）与 `ExportImport`（T3.4）会在对应任务中一并压到 300 行以内。

---

### P1 高频交互闭环阶段

#### T1.1 零依赖跨 Store 命令合并型 Undo/Redo 引擎
- 执行者：DeepSeek v4.1 Flash　日期：2026-11-12　提交：`3583dda`
- 结果：✅ 完成
- 验收逐条：
  - [x] `undoManager.ts`（196 行）支持 100 步环形栈、800ms 输入合并、按语言隔离与 `structuredClone` 深拷贝。
  - [x] 5 个业务 Store 接入 `HistoryOpts` 且撤销后正常触发 500ms 防抖落盘。
  - [x] `undoManager.test.ts` 11 条用例：推栈/撤销/重做/新操作截断 redo/800ms 合并窗口/跨语言隔离/100 步容量淘汰/清空。
- 关键实现：
  1. `undoManager.ts`：模块级 `undoStack/redoStack` + `useSyncExternalStore`，`pushUndoEntry` 在同 `coalesceKey` + 同语言 + ≤800ms 时**保留最初 `undo` 闭包**、仅替换 `redo` 与时间戳；`performUndo/performRedo` 支持按 `languageId` 从栈尾向前过滤（自实现 `findLastMatchingIndex`，避免触碰 tsconfig 的 `lib` 目标）。
  2. `configHistory.ts`：`recordConfigChange` 对前后像 `structuredClone`（杜绝可变引用污染），`attachConfigHistory` 为「配置整体替换型」Store 提供订阅式记录（含 `applying` 递归守卫）。
  3. 五处接入：
     - `lexiconStore.upsertWord/deleteWord`：显式 `HistoryOpts`，新增词条的 undo 走 `deleteWord(skipHistory)`；
     - `grammarStore/scaStore.applyEdit`：统一编辑入口记录，`restore` 回溯时再走 `applyEdit(..., { skipHistory: true })`；
     - `corpusStore.upsertCorpus`：语料行增删改全部经此漏斗；
     - `phonoStore`：16+ 个写方法都收敛到 `saveConfig()`，因此在 `saveConfig` 末尾对比 `localConfig` 基线单点记录，新增 `restoreLocalConfig(snapshot)` 作为回放入口（先对齐基线避免回放被二次记录）。
  4. UI：`UndoRedoButtons`（顶栏，悬停显示「撤销：编辑词条」）仅在非欢迎页渲染；`useUndoShortcuts()` 在 `App` 中绑定全局快捷键，`e.isComposing` 或焦点在 `INPUT/TEXTAREA/[contenteditable]` 时不拦截，保留浏览器字符级撤销体验。
- V-ALL：`[exit 0] × 8`（i18n 0/0；tsc 0 error；src 137 pass 含新增 11 条；mcp 34；cargo 47）。
- 偏差与决定：
  1. 撤销栈是模块级单例，`bun test` 中多个测试文件共享同一进程，故 `undoManager.test.ts` 增加 `beforeEach(clearHistory)` 保证隔离（首版仅 `afterEach` 时被其他 Store 测试推送的条目干扰）。
  2. 各 Store 的 `coalesceKey` 默认分别取 `lex:<entryId>`、`<domain>:<languagePath>`、`corpus:<id>:<lineCount>`——粒度按「同一实体/同一语言」定义，符合 PRD「打字不产生逐步撤销」的目标；粒度更细的按字段合并留待 T1.5 DSL 编辑器接入时再细化。

#### T1.2 语料反向索引引擎与词典详情三大内联卡片
- 执行者：DeepSeek v4.1 Flash　日期：2026-11-13　提交：`d5fa1fb`
- 结果：✅ 完成
- 验收逐条：
  - [x] `concordance.ts`（139 行）+ `concordance.test.ts`（9 条）通过；详情页接入例句出处、折叠屈折表、富信息演化链。
  - [x] MCP 注册 `corpus_concordance` 并更新 `expected-tools.ts` 与 `coverage-matrix.test.ts`；新增 5 条 InMemoryTransport 集成单测。
  - [x] 涉及组件均 ≤ 300 行（EditorPane 215 / useWordLineage 183 / WordConcordanceSection 127 / WordParadigmCollapsible 109 / EvolutionChainCards 78）。
- 关键实现：
  1. **双轨匹配**：①`GlossToken.linked_entry_id === entry.entry_id` 或 `morpheme_break` 首段（按 `-`/`·` 切分后归一化）等于词条词干；②表层 `normalizeToken()` 落在「基础形 ∪ 各词性 `generateParadigm()` 屈折形 ∪ extraForms」集合内。**同形异义防护**：Token 已显式关联到其他词条时，两条轨道都不成立（单测固化）。
  2. `limit`（默认 200）只截断 `matches`，`total` 始终为全量计数；空 `surface_form` 直接跳过；`gloss` 优先取 `gloss_labels`，否则回退词条释义拼接。
  3. 三张卡片：`WordParadigmCollapsible` 用「带 override 上下文」与「纯规则」两次 `generateParadigm` 结果比对来判定不规则格（不新增引擎 API），并提供跳转语法页；`WordConcordanceSection` 展开时才 `loadAllCorpusTexts()`（复用已打开的语料副本，失败落空数组防重试风暴），点击回填 `activeCorpusId` 后跳 `/corpus`；`EvolutionChainCards` 每代展示语言名 + 罗马字 + 该语言音系算出的 `/IPA/` + `ScriptLine` 本族字，并保留 SCA 规则徽章。
  4. **EditorPane 再瘦身**：把父语言/祖先链/生命周期/演化链派生逻辑整体抽到 `useWordLineage.ts`（183 行），EditorPane 215 行，为后续 T2.x 留出空间。
  5. MCP：`corpus_concordance`（`toolsets: ["core","compute"]`、`access: "read"`、`idempotent`）支持 `entry_id` 或 `word_romanized` 二选一定位词条，返回 `matches/total/corpus_texts_scanned/dependencies`；按 §7.6 把 `coverage-matrix.test.ts` 的 `toBe(76)` 改为 `toBeGreaterThanOrEqual(76)` 与 `toBe(EXPECTED_76_TOOLS.length)`，工具总数升至 77。
- V-ALL：`[exit 0] × 8` — i18n 0/0；tsc 0 error；`bun test src` 146 pass（新增 9）；`mcp:check` 0 error；`mcp:test` 39 pass（新增 5）；`cargo test` 47 pass。
- 偏差与决定：
  1. 集成测试用 `InMemoryTransport`（而非 `tools-e2e` 的 stdio 子进程）覆盖新工具，避免再起一个 MCP 进程拖慢套件；fixture 直接复用 `tests/fixtures/workspace-basic/branches/leaf`（`corp_leaf_1` 中 `entry_leaf_acha` 恰好 1 处出处）。
  2. 「点击定位到具体语料句」当前只做到「切到 `/corpus` 并激活对应语料文章」，未做行级滚动锚点——`CorpusPage` 尚无行锚机制，强行滚动需改动语料页布局，留待 T1.3 打开语料编辑链路时一并实现。

#### T1.3 语料三行标注侧边快建词条抽屉
- 执行者：待填　日期：—　提交：—
- 结果：待执行
- 验收逐条：
  - [ ] `CorpusQuickLexDrawer.tsx` 经 `ModalPortal` 挂载，建词后当场重跑当前句 `autoGloss`。
- V-ALL：待填
- 偏差与决定：无

#### T1.4 全局 `Cmd+K` 跨语系检索与即时沙盒演算面板
- 执行者：待填　日期：—　提交：—
- 结果：待执行
- 验收逐条：
  - [ ] 支持跨语系词库秒搜、`>` 动作跳转、`=` 前缀即时演算回显。
- V-ALL：待填
- 偏差与决定：无

#### T1.5 单行语言学规则 DSL ↔ 表单双向无损编辑器
- 执行者：待填　日期：—　提交：—
- 结果：待执行
- 验收逐条：
  - [ ] 罗马化、音位变体、SCA（字符+特征模式）往返无损且保留 `@id:<rule_id>`。
- V-ALL：待填
- 偏差与决定：无

---

### P2 核心语言学模型深化阶段

#### T2.1 P2 向后兼容持久化 Schema 同步扩展
- 执行者：待填　日期：—　提交：—
- 结果：待执行
- 验收逐条：
  - [ ] `src/types/index.ts`、`src-tauri/src/models.rs`、`mcp/storage/read.ts` 完成同步扩展。
  - [ ] `tests/golden/*.json` 零改动通过 Rust 与 MCP 双端 `conformance` 测试。
- V-ALL：待填
- 偏差与决定：无

#### T2.2 CLDF / Concepticon 核心概念库、词义绑定与旧标签迁移
- 执行者：待填　日期：—　提交：—
- 结果：待执行
- 验收逐条：
  - [ ] 内置 Swadesh-100 + Leipzig-Jakarta 100 核心概念库；支持 `ConceptPicker` 与旧标签迁移向导；注册 `concept_list` / `concept_upsert`。
- V-ALL：待填
- 偏差与决定：无

#### T2.3 全语系同源词矩阵引擎与虚拟化对照表视图
- 执行者：待填　日期：—　提交：—
- 结果：待执行
- 验收逐条：
  - [ ] `cognateMatrix.ts` 精确聚合祖语同源根、借词与创新；前端虚拟表格支持点击空白格补词；注册 `family_cognate_matrix`。
- V-ALL：待填
- 偏差与决定：无

#### T2.4 DAG 多词素构词图谱、词族树与过期复合词质检
- 执行者：待填　日期：—　提交：—
- 结果：待执行
- 验收逐条：
  - [ ] `wordFamily.ts` DFS 环检测拦截自指与间接环；详情展示词族树；质检支持 `staleCompound`；注册 `lex_word_family`。
- V-ALL：待填
- 偏差与决定：无

#### T2.5 共时形态音位层（`+` 边界）、多模式重音与超音段 SCA
- 执行者：待填　日期：—　提交：—
- 结果：待执行
- 验收逐条：
  - [ ] `morphophonology.ts` 支持 `+` 词素边界音变；重音支持 5 种模式；SCA 支持 `±stressed` 与音节开闭伪特征。
- V-ALL：待填
- 偏差与决定：无

#### T2.6 历时语法词缀演化同步与同音中和（Syncretism）预警
- 执行者：待填　日期：—　提交：—
- 结果：待执行
- 验收逐条：
  - [ ] `grammarPullSync.ts` 演化 `sca_mutable` 词缀与不规则表并检出范畴合流警告；注册 `gram_pull_sync`。
- V-ALL：待填
- 偏差与决定：无

---

### P3 专业深水区与出版闭环阶段

#### T3.1 HarfBuzz WASM 字形几何与排版度量审计纯引擎
- 执行者：待填　日期：—　提交：—
- 结果：待执行
- 验收逐条：
  - [ ] `fontGeometryAudit.ts` 完成贝塞尔采样、上下基线超调量、附标高度带 `opticalGapX` 与扫描线字重计算；注册 `font_audit_geometry`。
- V-ALL：待填
- 偏差与决定：无

#### T3.2 书写系统可视化基准线叠加层与异常字形诊断面板
- 执行者：待填　日期：—　提交：—
- 结果：待执行
- 验收逐条：
  - [ ] `GlyphGeometryInspector.tsx` 支持排版标尺开关与参差字形高亮筛选。
- V-ALL：待填
- 偏差与决定：无

#### T3.3 递归短语结构树与格对齐（Nom-Acc / Erg-Abs）句法台
- 执行者：待填　日期：—　提交：—
- 结果：待执行
- 验收逐条：
  - [ ] `phraseSandbox.ts` 完成三阶段线性化，修复多修饰语归属并支持主宾格/作通格/三分格；`sandbox_translate` 同步支持 `clause`。
- V-ALL：待填
- 偏差与决定：无

#### T3.4 出版级《参考语法与双向词典》单文件 HTML/矢量打印与 Typst 导出
- 执行者：待填　日期：—　提交：—
- 结果：待执行
- 验收逐条：
  - [ ] `referenceBookBuilder.ts` 输出自包含 Base64 字体单文件 HTML 与 `.typ` 源码；HTML 转义防注入与 `document.fonts.ready` 打印守卫完备。
- V-ALL：待填
- 偏差与决定：无
