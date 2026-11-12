# Conlang Maker 核心产品力跃升 · 产品需求与技术规格文档（PRD）

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v1.0（P0–P3 全量非 AI 本体演进规格） |
| 日期 | 2026-11-12 |
| 关联执行计划 | [EXECUTION_PLAN.md](./EXECUTION_PLAN.md) |
| 关联执行日志 | [EXECUTION_LOG.md](./EXECUTION_LOG.md) |
| 范围说明 | 聚焦工程底座、交互效率、语言学形式化建模与专业排版质检；**不含任何 LLM / AI 生成特性**，确保确定性底座 100% 自洽 |

---

## 0. 设计原则与全局硬性约束

1. **确定性与同源计算（Single Source of Truth）**：所有新增语言学计算（音节切分、质检、词族追踪、同源词聚合、形态音位、超音段音变、句法线性化、字形几何诊断、出版文档渲染模型）一律实现在 `src/core/` 纯函数层（禁止依赖 React / DOM / Tauri / Node FS），由桌面端 GUI 与 `mcp/` 服务 100% 同源复用。
2. **零破坏向后兼容（Zero-Breakage Persistence）**：
   - 所有在 `WorkspaceConfig`、`PhonologyConfig`、`WordEntry`、`Sense`、`Etymology`、`GrammarConfig`、`SCARule` 上新增的持久化字段必须为可选字段。
   - Rust `src-tauri/src/models.rs` 对应字段**必须**标注 `#[serde(default, skip_serializing_if = "Option::is_none")]` 或 `#[serde(default, skip_serializing_if = "Vec::is_empty")]`，新增结构体必须保留 `#[serde(default, flatten)] pub extra: ExtraFields;`，确保未启用新特性的旧工作区与 `tests/golden/*.json` 黄金快照**逐字节零差异**。
3. **开发规范红线（对齐 `.agents/rules/gemini.md`）**：
   - 前端禁止引入新的状态管理库或 CSS 框架（允许引入无样式虚拟滚动 Hook 库 `@tanstack/react-virtual`）；
   - TypeScript 严格禁止 `any`；
   - 单个 React 组件文件严格 `≤ 300` 行；
   - 所有 UI 文案同时写入 `src/i18n/zh.ts` 与 `src/i18n/en.ts`；
   - 所有弹窗统一经过 `src/components/common/ModalPortal.tsx`；样式常量统一走 `src/lib/ui.ts`。

---

## 1. 现状基线与痛点映射表

| 梯度 | 编号 | 核心痛点（代码现状） | 目标状态 |
| --- | --- | --- | --- |
| **P0** | P0-1 | `.github/workflows/ci.yml` 未运行任何单测、`core:check`、`i18n:check`、`mcp:test`；存在 139 个未引用僵尸翻译键 | 全平台 CI 完整跑通 6 道门禁；僵尸翻译键清零或白名单化 |
| **P0** | P0-2 | `qualityCheck.ts` 仅按单字符集合查拼写；未校验音节结构、黑名单、元音和谐与同音碰撞；`romanizationLint.ts` 未接入 GUI | 基于最长匹配分词器 + **DP 最大声母音节切分器**的全维质检；罗马化编辑器实时展示遮蔽/不可达/越界告警 |
| **P0** | P0-3 | `EditorPane.tsx`(691行)、`Sidebar.tsx`(688行)、`RuleSetList.tsx`(634行)、`SCAPreview.tsx`(559行) 严重超长；列表无虚拟滚动；父语言词库重复 IPC 加载 | 核心大组件全部拆回 `≤ 300` 行；引入 `@tanstack/react-virtual` 动态高度虚拟列表；新增谱系词库缓存层 |
| **P1** | P1-1 | 仅有重型磁盘快照，无日常编辑 `Cmd+Z` / `Cmd+Shift+Z` 细粒度撤销 | 零外部依赖的跨 Store 命令合并型环形历史栈（Undo/Redo），与 500ms 防抖落盘无缝协同 |
| **P1** | P1-2 | 语料三行标注遇到生词需跳页建词；词典看不到语料例句引用与内联范式 | 「语料 ↔ 词典 ↔ 语法」侧边抽屉建词 + 词典详情内联语料反向索引（Concordance）、折叠屈折预览与富信息演化链 |
| **P1** | P1-3 | `QuickEntry` 仅能简单录词，无法全局跨语系检索或随手试跑规则 | 全局 `Cmd+K` 命令与即时演算面板（跨语系搜词/概念 + 即时 IPA/本族字/屈折/SCA 沙盒试算） |
| **P1** | P1-4 | 罗马化、音位变体与 SCA 规则录入过度依赖多列表单点击 | 「单行语言学 DSL（如 `k > tʃ / _ [i, e]`）↔ 可视化表单」双向无损同步编辑器 |
| **P2** | P2-1 | 词与概念耦合在自由文本 `gloss` 中，被迫手打 `"概念071"` 标签，无跨语支对比视图 | CLDF / Concepticon 兼容的一等公民 `Concept` 层（内置 Swadesh-100 + Leipzig-Jakarta 100 + 自定义概念集）与全语系同源词矩阵（Cognate Matrix） |
| **P2** | P2-2 | `parent_entry_id` 仅单值，无法表达 `A+B→AB` 复合词与共时派生词族 | 有向无环（DAG）多词素构词图谱（`MorphemeComponent[]`），词典内联词族树与词根变更级联脏标记提示 |
| **P2** | P2-3 | 词缀拼接后缺少词素边界音变层；重音仅限 `initial`；SCA 不感知重音与音节边界 | 独立共时形态音位层（Morphophonology `+` 边界规则）+ 多模式重音（末音节/倒数第二/音重敏感）+ 超音段感知 SCA |
| **P2** | P2-4 | `sca_mutable` 字段闲置，子语言只能同步词典，语法词缀与不规则表需纯手改 | 历时语法词缀与不规则覆盖演化同步工作流（含词缀合流/同音中和 Syncretism 预警） |
| **P3** | P3-1 | 自制字体缺乏基线超调量、附标光学间距、字重均匀度的量化检测 | 基于 HarfBuzz WASM 轮廓提取与射线扫描的「字形几何与排版度量质检面板」+ 可视化基准标尺 |
| **P3** | P3-2 | `sandbox.ts` 为扁平 S/V/O 桶排序，修饰语错绑且不支持作通格等对齐类型 | 基于递归短语结构树（Clause / NP / PP）与形态句法对齐（Nom-Acc / Erg-Abs / Tripartite）的结构化句法测试台 |
| **P3** | P3-3 | `exportPDF.ts` 基于 `jspdf` 默认西文字体，中文、IPA 与本族 OpenType 连字全部乱码或丢失 | 基于内嵌 `@font-face` Base64 + Paged CSS 的单文件出版级《参考语法与双向词典》（支持系统原生矢量打印 PDF 与 Typst 源码导出） |

---

## 2. P0 详细规格：工程护栏、精确音系质检与高性能列表架构

### 2.1 CI 全量门禁与翻译键治理（P0-1）

1. **CI 流水线扩展（`.github/workflows/ci.yml`）**：在三平台矩阵（Ubuntu / macOS / Windows）中依次执行：
   - `bun run version:check`
   - `bun run i18n:check`
   - `bun run core:check`
   - `bunx tsc --noEmit`
   - `bun test src`
   - `bun run mcp:check`
   - `bun run mcp:test`
   - `cargo test --manifest-path src-tauri/Cargo.toml`
2. **僵尸翻译键清理**：对 `scripts/i18n-check.mjs` 报告的未使用键进行排查——确属已废弃功能的从 `en.ts` 与 `zh.ts` 同步移除；属动态拼接合法引用的（如 IPA 音标分类表头）改为显式 `Record<LiteralType, string>` 映射函数，将未使用键告警降至 `0`。

### 2.2 最优音节切分器与全维词典质检引擎（P0-2）

#### 算法选型：基于音素 Token 序列的「DP + 最大声母原则（Maximal Onset Principle）」音节切分器
禁止用字符串正则直接匹配多字符 IPA（避免 `tʃ`、`kʰ`、`aː` 被拆碎）。新建 `src/core/engines/syllabifier.ts`：

1. **模板编译**：解析 `phonotactics.syllable_structure`（兼容 `(C)(L)V(N)` 括号可选组与 `C?VC?` 问号可选符，支持多层并列槽位）：
   - 将每个槽位分类为 `onset`（核前槽位）、`nucleus`（首个匹配元音集合 `vowels` 的核心槽位及紧邻元音槽位）、`coda`（核后槽位）。
2. **动态规划切分（时间复杂度 $O(N \cdot S^2)$，单条词 `< 0.05\text{ms}$）**：
   - 输入：经 `romanizationToPhonemes` 分词并剥离超音段标记后的 `phonemes: string[]`（长度 $N$）。
   - 定义状态 `dp[i]` 为前缀 `phonemes[0..i]` 的最优合法音节序列 `ParsedSyllable[] | null`。
   - **消歧准则（Maximal Onset Tie-Breaking）**：当同一词存在多种合法音节划分（例如 `(C)V(C)` 下 `a.pa` 与 `ap.a`）时，定义代价函数优先最小化总音节数，其次在相邻音节交界处**最大化后一音节的 `onset.length`**（符合人类语言普遍的最大声母原则）。
3. **输出数据结构**：
   ```ts
   export interface ParsedSyllable {
     onset: string[];
     nucleus: string[];
     coda: string[];
     weight: "light" | "heavy"; // coda.length > 0 || nucleus.length > 1 || nucleus 含长音 'ː' 时为 heavy
   }
   export interface SyllabificationResult {
     valid: boolean;
     syllables: ParsedSyllable[];
     failedAtTokenIndex?: number;
   }
   ```
4. **词典质检规则扩展（`src/core/engines/qualityCheck.ts`）**：
   - `QCRuleKey` 扩展为：
     `"missingPos" | "unmappedSpelling" | "emptyIpa" | "patternMismatch" | "missingRequired" | "duplicateWord" | "phonotacticViolation" | "blacklistHit" | "vowelHarmonyViolation" | "homophonyClash"`
   - **`unmappedSpelling` 升级**：改用 `romanizationToPhonemesTraced` 检查是否存在 `fallback`（未命中任何罗马音规则的原样透传非空白字符），彻底修复多合字母漏检与假阳性。
   - **`phonotacticViolation`**：当 `syllable_structure.trim()` 非空时调用 `syllabify()`，切分失败给出具体卡住的音素位置。
   - **`blacklistHit`**：检查分词后的音素串或罗马字是否命中 `phonotactics.blacklist_patterns`。
   - **`vowelHarmonyViolation`**：当 `vowel_harmony.enabled` 开启时，同一词根内同时出现 `group_a` 与 `group_b` 音素则报 `warning`（若后续为复合词，按各词根分段独立校验）。
   - **`homophonyClash`**：拼写不同或词条不同，但有效表层发音 `effectivePronunciation` 完全一致且存在相同 `pos_id` 时报 `warning`。
5. **罗马化实时诊断上屏**：在 `RomanizationEditor.tsx` 顶部直接调用 `analyzeRomanization()`（已有纯函数 `romanizationLint.ts`），折叠展示：① 被前序规则遮蔽的死规则（行内高亮标黄）、② 音素表中无规则可达的孤立音素、③ 规则输出不在音素表中的越界音素。

### 2.3 谱系词库缓存层、虚拟滚动与大组件解耦（P0-3）

1. **祖先词库按需缓存 Store（`src/store/lineageLexiconStore.ts`）**：
   - 消除目前 `Sidebar.tsx` 与 `EditorPane.tsx` 各自独立调用 `invoke("load_all_words")` 重复拉取父语言与祖先链词表的问题。
   - 以 `${projectPath}::${languagePath}` 为键缓存 `{ wordsById, phonoConfig, revision }`；监听外部文件变更事件按 `revision` 增量失效。
2. **动态高度虚拟列表（`@tanstack/react-virtual`）**：
   - 接入位置：`Sidebar.tsx` 词典列表、`SCAPreview.tsx` 全量音变预览表（移除硬性分页卡顿）、`QualityCheck.tsx` 问题列表。
   - 严格实现规范：外层滚动容器设 `contain: strict`；虚拟行挂载 `ref={virtualizer.measureElement}` 与 `data-index={virtualRow.index}`，**严禁在测量节点写固定 `height` 或外 `margin`**（间距一律用内层 `pb-1` `padding`），防止滚动跳动。
3. **超长组件职责拆分（全部控制在 `≤ 300` 行）**：
   - `Sidebar.tsx` (688行) → `Sidebar.tsx`（容器组装）+ `LexiconFilterBar.tsx`（搜索/IPA/标签/生命周期筛选）+ `LexiconVirtualList.tsx`（虚拟行与词条卡片）。
   - `EditorPane.tsx` (691行) → `EditorPane.tsx`（主骨架）+ `WordHeaderSection.tsx`（词头/文字预览/IPA/生命周期徽章）+ `WordSensesSection.tsx`（多义项与例句编辑）+ `WordEtymologySection.tsx`（词源/演化链/废弃控制）。
   - `RuleSetList.tsx` (634行) → `RuleSetList.tsx` + `SCARuleCard.tsx` + `SCARuleEditorRow.tsx`。
   - `SCAPreview.tsx` (559行) → `SCAPreview.tsx` + `SCASingleTester.tsx` + `SCABatchVirtualPreview.tsx`。

---

## 3. P1 详细规格：高频交互闭环与零跳转心流

### 3.1 零外部依赖的跨 Store 撤销/重做引擎（P1-1）

#### 算法选型：带时间窗合并（Coalescing）的命令补丁环形栈（`src/store/undoManager.ts`）
不引入任何新状态管理库（遵守 `gemini.md` 第 1 条），同时兼容现有的“按实体 ID 500ms 防抖保存”：

1. **数据结构**：
   ```ts
   export type UndoDomain = "lexicon" | "phonology" | "grammar" | "sca" | "corpus";
   export interface UndoEntry {
     id: string;
     languageId: string;
     domain: UndoDomain;
     labelKey: string;          // i18n key，用于 Toast/Tooltip 提示“已撤销：编辑词条”
     coalesceKey?: string;      // 如 "lex:entry_01:romanized"
     timestamp: number;
     undo: () => void | Promise<void>;
     redo: () => void | Promise<void>;
   }
   ```
2. **关键机制**：
   - **容量上限**：环形缓冲最多保留最近 `100` 步，内存占用可忽略。
   - **输入合并（Input Coalescing）**：当连续两次变更具有相同非空 `coalesceKey` 且时间差 `≤ 800ms` 时，保留第一次变更的 `undo` 闭包（最初前像），仅替换最新 `redo` 闭包与 `timestamp`，避免打字每敲一个字母产生一步撤销。
   - **落盘一致性**：`undo()` / `redo()` 内部调用各 Store 带 `{ skipHistory: true }` 标记的标准写方法（如 `upsertWord(prevWord, { skipHistory: true })`），从而自动复用原有的 500ms 实体防抖落盘与 `revision` 更新，保证磁盘与内存永远一致。
   - **焦点隔离**：当焦点位于原生 `<input>` / `<textarea>` 且浏览器自身文本选区正在输入时，保留原生字符级输入体验，或通过全局快捷键监听在非 IME 组合态（`!e.isComposing`）下统一调度，顶部标题栏提供可视化 `Undo / Redo` 按钮与悬停步名。
   - **切换项目清空、切换语言按 `languageId` 过滤或分桶**，防止跨语言误撤。

### 3.2 「语料 ↔ 词典 ↔ 语法」行内联动抽屉与反向索引（P1-2）

1. **语料页侧边快建抽屉（`CorpusQuickLexDrawer.tsx`，经 `ModalPortal` 挂载）**：
   - 在 `GlossingEditor.tsx` 点击未解析词（Unresolved）或任意 Token 的“新建/关联词条”按钮时，右侧滑出抽屉，自动预填词形（若能由反向屈折剥离疑似词缀则给出词干建议），选定词性与 `gloss` 保存后，当场重跑当前句 `autoGloss` 回填标注，零路由切换。
2. **语料反向索引纯引擎（`src/core/engines/concordance.ts`）**：
   - 输入：`entryId: string`、`conWordRomanized: string`、`corpusTexts: CorpusText[]`。
   - 匹配策略：**双轨精准匹配**——优先匹配 `GlossToken` 已绑定同一词条/词干的行；兜底匹配分词归一化相同的词形，输出 `{ textId, title, lineId, originalLine, freeTranslation, matchedTokenSurface, gloss }[]`。
3. **词典详情内联增强（`EditorPane` 子面板）**：
   - **折叠式屈折速览卡片（`WordParadigmCollapsible.tsx`）**：根据该词条首个义项 `pos_id` 即时渲染紧凑屈折表（含不规则覆盖高亮与一键跳转定制）。
   - **语料例句引用卡片（`WordConcordanceSection.tsx`）**：展示该词在语料库中的所有真实出处，点击一键定位到对应语料句。
   - **富信息演化链卡片**：将原有的纯文本 `a → b → c` 升级为展示每代祖先的 `语言名 + 罗马字 + /IPA/ + 本族文字` 徽章链。

### 3.3 全局 `Cmd+K` 命令与即时演算面板（P1-3）

升级 `QuickEntry.tsx` 为全局调色板 `CommandPalette.tsx`（快捷键 `Cmd+K` / `Ctrl+K`）：
- **模式 1（默认检索）**：跨当前工作区**所有子语言**毫秒级检索罗马字、IPA、释义、标签/概念，回车直达对应语言的对应词条。
- **模式 2（`>` 动作与导航）**：快速切换当前语言、跳转各模块页、一键新建词条。
- **模式 3（`=` 即时沙盒试算）**：输入 `= <词形>`，面板底部实时回显当前语言下的：`自动分词 → 音位/音值 IPA → 音节切分结果 → 本族文字渲染 → 父到子 SCA 试算结果`，随测随关。

### 3.4 规则编辑器「单行 DSL ↔ 表单」双模同步（P1-4）

新建纯双向解析/序列化引擎 `src/core/engines/ruleDsl.ts`：
- **统一语法**：`<target> -> <replacement> / <before> _ <after>  # <可选说明>`（兼容 `->`、`>`、`→`；空位支持 `∅` 或 `0`；罗马化分隔符规则支持 `-> [sep]`）。
- **无损往返**：表单列表与多行代码文本域一键切换；DSL 模式下按行实时解析，语法错误精准给出 `{ line, column, message }` 行内红标提示，合法时才写回规则数组。
- **覆盖范围**：`RomanizationEditor`、`AllophonyEditor`、`SCARuleSet` 编辑区全面接入。

---

## 4. P2 详细规格：核心语言学模型深化（概念层、构词图谱、形态音位与历时语法）

### 4.1 CLDF / Concepticon 兼容概念层与跨语系同源词矩阵（P2-1）

#### 数据模型扩展（`src/types/index.ts` & `src-tauri/src/models.rs`）
```ts
export interface ConceptDefinition {
  concept_id: string;           // 稳定键，如 "CONCEPT_WATER" 或用户自定义 "CUSTOM_CALENDAR_MONTH"
  gloss_en: string;
  gloss_zh: string;
  semantic_field: string;       // 如 "nature" | "body" | "kinship" | "trade" | "calendar" | "custom"
  concepticon_id?: string;      // 标准 Concepticon 集编号，如 "1359" (WATER)
  standard_lists?: ("swadesh_100" | "leipzig_jakarta_100")[];
}

// Sense 新增可选字段（向后兼容）：
export interface Sense {
  // ...既有字段保持不变
  concept_id?: string;          // 绑定跨语言概念锚点
}

// WorkspaceConfig 新增可选自定义概念表（存于 *.conlang）：
export interface WorkspaceConfig {
  workspace_version: string;
  languages: LanguageEntry[];
  custom_concepts?: ConceptDefinition[];
}
```
1. **内置核心概念库（`src/data/core_concepts.ts`）**：整理合并 **Swadesh-100** 与 **Leipzig-Jakarta 100** 去重后的 ~138 个高稳定性核心概念（带标准 `concepticon_id`、中英双语名与语义域分类），并支持工作区新增世界观专属概念，以及**一键将旧标签（如 `概念:xxx` / `概念071`）批量迁移绑定到正式 `concept_id` 的向导函数**。
2. **全语系同源词矩阵（`CognateMatrixPage` 或词典/谱系内子标签页 + 纯引擎 `src/core/engines/cognateMatrix.ts`）**：
   - 行：概念（支持按 Swadesh / Leipzig-Jakarta / 自定义语义域 / 缺词率筛选）；
   - 列：谱系树拓扑序排列的各门语言；
   - 单元格：展示绑定该 `concept_id` 的词条（罗马字 + 本族文字 + IPA），并按词源自动着色区分**同源继承集（Cognate Set，共享同一祖语根 ID）**、**借词（Borrowed）**与**支系本土创新（Innovation）**；空白格支持点击原地快建词条并自动绑定 `concept_id`。

### 4.2 有向无环（DAG）多词素构词图谱与词族视图（P2-2）

#### 数据模型扩展
```ts
export type CompoundRelation = "root" | "modifier" | "head" | "affix" | "reduplicant";

export interface MorphemeComponent {
  entry_id?: string;            // 指向本语言内基础词根词条 ID
  derivation_rule_id?: string;  // 若为派生词缀，指向 grammar.derivation_rules
  surface_override?: string;    // 连音缩写时的表层片段说明
  relation: CompoundRelation;
}

export interface Etymology {
  // ...既有字段保持不变（parent_entry_id 专注跨语言父→子历时继承！）
  components?: MorphemeComponent[];      // 共时构词成分有序列表（支持 A + B -> AB 多词根复合词）
  compounds_stale_digest?: string;       // 上次核验时各成分词根读音摘要，用于检测词根改音后的级联过期
}
```
#### 核心算法（`src/core/engines/wordFamily.ts`）
1. **DAG 环路检测（Tarjan / DFS 三色标记法）**：在编辑 `components` 添加词根引用前运行 `wouldIntroduceCycle(childId, candidateRootId, wordsMap)`，严禁 `A → B → A` 自指或环路。
2. **正反向词族树构建**：`O(V + E)` 构建单语言内的 `rootsOf(entryId)`（拆解构词树）与 `descendantsOf(entryId)`（列出所有直接/间接用到该词根的派生词与复合词）。
3. **级联过期提示（Stale Compound QC）**：当词根 `A` 读音修改或经受 Pull Sync 音变后，依赖 `A` 但尚未同步重算的复合词 `AB` 在质检与详情页提示 `staleCompound` 一键重算预览，绝不静默篡改用户精调过的缩合词形。

### 4.3 共时形态音位层（Morphophonology）与超音段音变升级（P2-3）

1. **共时形态音位规则层（`GrammarConfig.morphophonology_rules?: MorphophonologyRule[]`）**：
   ```ts
   export interface MorphophonologyRule {
     rule_id: string;
     description: string;
     disabled?: boolean;
     priority: number;
     /** 复用 SCARule 规则体：字符模式或特征模式，允许 context_before / context_after 中出现 '+' 代表词素边界 */
     target: string;
     replacement: string;
     context_before: string;
     context_after: string;
     feature_mode: boolean;
     target_features: FeatureExpression | null;
     replacement_features: FeatureReplacement | null;
     context_before_features: FeatureExpression | null;
     context_after_features: FeatureExpression | null;
   }
   ```
   - 在 `morphologyEngine` 拼接词干与词缀时，内部保留显式词素边界符号 `+`（如 `kat+lar`），随后按 `priority` 升序依次执行未禁用的 `morphophonology_rules`（复用 `scaEngine` 的特征与环境匹配能力，允许在环境中使用 `+` 精准定位词素交界处，实现**元音和谐词缀交替 `[+vowel, +back] > [-back] / [-back, +vowel] C* + C* _`**、**连浊**、**辅音同化**、**元音连读省音**），最后剥离 `+` 再交给 `ipaGenerator` 与 `allophony_rules`。
2. **多模式重音系统（`Phonotactics.stress` 扩展）**：
   ```ts
   export type StressPattern =
     | "initial"          // 首音节
     | "ultimate"         // 末音节
     | "penultimate"      // 倒数第二音节
     | "antepenultimate"  // 倒数第三音节
     | "weight_sensitive"; // 音重敏感（如拉丁/阿拉伯式：若倒数第二音节为 heavy 则重读，否则回退倒数第三；或最右重音节优先）
   export interface StressConfig {
     position: StressPattern;
     domain: "word" | "entry";
     weight_fallback?: "initial" | "penultimate" | "antepenultimate";
   }
   ```
   直接基于 §2.2 的 `syllabify()` 结果精确标注重音符 `ˈ` 于对应音节起点，完美向后兼容旧值 `{ position: "initial", domain: "word" }`。
3. **超音段感知 SCA（`scaEngine.ts` 扩展）**：
   - 在音素分词与特征匹配阶段，将音节核上的主重音映射为合成特征 `+stressed` / `-stressed`（以及音节位置伪特征 `+initial_syllable` / `+final_syllable` / `+open_syllable` / `+closed_syllable`），使 SCA 原生支持**非重读元音弱化/央化（如 `[+vowel, -stressed] > ə`）**、**闭音节长元音缩短（`[+vowel, +long, +closed_syllable] > [-long]`）**等核心自然主义音变。

### 4.4 历时语法词缀演化同步（P2-4）

新建纯工作流 `src/core/workflows/grammarPullSync.ts` 与前端弹窗 `GrammarSyncModal.tsx`：
- 扫描父语言的 `inflection_rules`、`derivation_rules`（筛选 `sca_mutable !== false`）以及 `irregular_overrides`；
- 将词缀音段经由子语言 `scaConfig` 演化推导，生成逐条 Diff 预览：
  - 标注词缀语音演变结果（如 `-an → -ã → -a`）；
  - **同音中和预警（Syncretism Warning）**：若父语言中原本区分的两个格/时态词缀（如主格 `-a` 与宾格 `-an`）在子语言音变后合并为同一形式 `-a`，高亮发出“形态范畴合流预警”，辅助造语者决定是保留融合、补充新助词还是调整语序。

---

## 5. P3 详细规格：字形几何质检、短语句法台与出版级导出

### 5.1 基于 HarfBuzz WASM 的字形几何与排版度量质检仪（P3-1）

新建纯分析引擎 `src/core/engines/fontGeometryAudit.ts`（输入由 `harfbuzzjs` `font.glyphToJson(gid)` / `glyphExtents(gid)` 提取的精确轮廓指令）：

1. **量化计算四大排版一致性指标**：
   - **垂直基准线偏差**：统计所有基础字形（按 `GlyphAnnotation.kind === "base" | "carrier"` 或自动归类）的 `yMax` 与主干底边 `yMin`（自动识别并剔除降部字母的深降部轮廓），计算相对中位数的超调偏差（Overshoot $\Delta y$），标记偏离超过阈值（如 `> 25‰ UPM`）的参差字形。
   - **附标光学间距（Optical Gap）离散度**：对复合音节字形或 `mark` 组合，不仅算外接矩形间距 `bboxGapX`，更在附标所在的垂直高度带 $[y_{\text{mark,min}}-30, y_{\text{mark,max}}+30]$ 内对基础字形右侧轮廓采样求真实水平净距 `opticalGapX`，精准揪出“包围盒距离相等、但因底座上窄下宽导致附标视觉悬空过远或粘连”的字形。
   - **笔画粗细（Stem Weight）均匀度**：通过 40 条等距水平/垂直扫描线求交点弦长四分位值（Q1），估算各字形水平与竖直主干粗细，标记过细或过粗的异常字形。
   - **横向占比分布**：统计基础辅音宽度与元音附标宽度占字宽（Advance Width）的百分比分布及左右留白（LSB/RSB）一致性。
2. **可视化标尺叠加层（`GlyphGeometryInspector.tsx`）**：在 `WritingPage` 字形预览网格与单字放大镜中支持开关 SVG 参考线（Ascender / CapHeight / x-height / Baseline `y=0` / Descender / LSB·RSB 边界框）并高亮异常字形。

### 5.2 短语结构树与格对齐句法测试台（P3-2）

重写 `src/core/engines/sandbox.ts`（保留旧版简单入口兼容已有调用，新增结构化引擎 `phraseSandbox.ts`）：
1. **语法配置向后兼容扩展**：
   ```ts
   export type MorphosyntacticAlignment = "nom_acc" | "erg_abs" | "tripartite";
   export interface CaseDimBinding {
     dim_id: string;
     val_id: string;
   }
   export interface SyntaxConfig {
     word_order: WordOrder;
     modifier_position: ModifierPosition;
     adposition_type: AdpositionType;
     alignment?: MorphosyntacticAlignment; // 默认 "nom_acc"
     /** 可选显式绑定格维度值；未配置时自动按 DimensionValue.gloss 大小写不敏感匹配 NOM/ACC/ERG/ABS/GEN */
     case_gloss_map?: Partial<Record<"nom" | "acc" | "erg" | "abs" | "gen", CaseDimBinding>>;
   }
   ```
2. **递归短语结构树（AST）**：
   - `NPNode`：`{ headGloss, number?, determinerGloss?, numeralGloss?, modifiers: string[], possessor?: NPNode, relativeClause?: ClauseNode }`
   - `PPNode`：`{ adpositionGloss, object: NPNode }`
   - `ClauseNode`：`{ verbGloss, subject?: NPNode, object?: NPNode, obliques?: PPNode[], tamValues?: Record<string, string>, polarity?: "affirmative" | "negative" }`
3. **三阶段确定性线性化**：
   - **阶段 1（格对齐分配）**：根据及物性（是否有 `object`）与 `alignment`，自动为 `S/A/P` 分配：
     - `nom_acc`：不及物 `S = NOM`；及物 `A = NOM, P = ACC`
     - `erg_abs`：不及物 `S = ABS`；及物 `A = ERG, P = ABS`
     - `tripartite`：不及物 `S = NOM/INTR`；及物 `A = ERG, P = ACC`
     - 领属定语 `possessor` 自动分配 `GEN`；
   - **阶段 2（核心/依附标记与一致关系）**：按 `typology.head_marking` 决定将论元特征标在动词槽位、名词格词缀还是双标，并支持形容词与中心名词性数格协变；
   - **阶段 3（递归语序排布与形态音位渲染）**：按 `word_order`、`modifier_position`、`adposition_type` 深度优先展开 Token 树，逐词跑完 `morphologyEngine → morphophonology → ipaGenerator → fontInput`，输出完整的**本族文字句 + 表层罗马字 + IPA + Leipzig 三行对译 + 语法树展开追踪**。

### 5.3 出版级《参考语法与双向词典》排版导出（P3-3）

新建纯文档组装引擎 `src/core/engines/referenceBookBuilder.ts` 与前端预览导出器：
1. **自包含印刷级单文件 HTML（主推荐导出）**：
   - 将当前语言的 `.otf/.ttf` 字体编码为 `@font-face { src: url("data:font/otf;base64,..."); font-feature-settings: ... }` 内嵌进独立 HTML；
   - 内置学术专著级 Paged CSS（`@page` 页边距、自动目录、章节分页保护 `break-inside: avoid`、Leipzig 三行对齐块 `inline-flex`、音素矩阵表、自动屈折范式表、谱系树 SVG）；
   - **双向词典双栏排版（`column-count: 2`）**：自动生成 **Part I: Conlang → 释义**（含本族文字词头、IPA、词性、概念标签、词源演化链、语料例句）与 **Part II: 释义/概念 → Conlang 反向检索索引**；
   - 支持一键保存 `.html` 电子书，或调起 WebView 原生矢量打印对话框输出**零乱码、100% 保留 OpenType 连字与 CJK/IPA 的矢量 PDF**（彻底解决旧版 `jspdf` 乱码缺陷）。
2. **学术源码导出（可选格式）**：同步支持导出结构化 **Typst (`.typ`)** 源码包，方便重度排版用户二次定制出版。

---

## 6. MCP 同源能力同步矩阵（精确工具契约）

凡是在 `src/core/` 新增的纯计算与结构化字段，必须在对应任务同步注册或增强 MCP 工具（原基线共 `76` 个工具，全部完成后扩展为 `83` 个工具，必须同步更新 `mcp/tests/expected-tools.ts` 与 `mcp/tests/coverage-matrix.test.ts`）：

| 任务 ID | 工具名 | 操作类型 | `toolsets` | `access` | 核心入参（Zod） | 核心返回结构 |
| :---: | :--- | :---: | :---: | :---: | :--- | :--- |
| **T0.2** | `lex_quality_check`（增强） | 既有增强 | `["audit"]` | `"read"` | 保持现有签名不变 | `issues` 自动包含新增的 4 类音系/同音质检项及 `staleCompound`(T2.4) |
| **T1.2** | `corpus_concordance` | **新增** | `["core", "compute"]` | `"read"` | `family_id`, `language_id`, `entry_id?`, `word_romanized?`, `limit?` | `{ matches: ConcordanceHit[], total: number }` |
| **T2.2** | `concept_list` | **新增** | `["core"]` | `"read"` | `family_id`, `list_filter?: "all" \| "swadesh_100" \| "leipzig_jakarta_100" \| "custom"`, `semantic_field?`, `query?` | `{ concepts: ConceptDefinition[], total: number }` |
| **T2.2** | `concept_upsert` | **新增** | `["write"]` | `"write"` | `family_id`, `expected_revision?`, `concept: ConceptDefinition` | `WriteResult & { concept: ConceptDefinition }` |
| **T2.3** | `family_cognate_matrix` | **新增** | `["core", "evolution"]` | `"read"` | `family_id`, `concept_ids?: string[]`, `list_filter?`, `limit?`, `cursor?` | `{ languages, rows: CognateMatrixRow[], next_cursor? }` |
| **T2.4** | `lex_word_family` | **新增** | `["core", "compute"]` | `"read"` | `family_id`, `language_id`, `entry_id` | `{ entry_id, roots: WordFamilyNode[], descendants: WordFamilyNode[], is_stale: boolean }` |
| **T2.6** | `gram_pull_sync` | **新增** | `["evolution", "write"]` | `"write"` | `family_id`, `target_language_id`, `dry_run?: boolean`, `rule_ids?: string[]`, `expected_revision?` | `{ dry_run, diffs, syncretism_warnings, write_result? }` |
| **T3.1** | `font_audit_geometry` | **新增** | `["audit"]` | `"read"` | `family_id`, `language_id`, `overshoot_threshold_permille?: number` | `{ metrics, baseline_outliers, optical_gap_outliers, stem_weight_outliers, width_stats }` |
| **T3.3** | `sandbox_translate`（增强） | 既有增强 | `["compute"]` | `"read"` | 保留原 `sentence` 兼容参数，新增可选 `clause?: ClauseNode` | 结构化模式下额外返回 `tokens`, `interlinear`, `alignment_trace` |

---

## 7. 非功能与质量指标

1. **性能预算**：
   - `10,000` 词规模下，词典侧边栏滚动帧率稳定 `60fps`，首屏渲染 `< 80ms`；
   - 单语言 `2,000` 词全量 10 项质检（含 DP 音节切分）总耗时 `< 150ms`；
   - `Cmd+Z` 单步撤销响应耗时 `< 16ms`。
2. **代码健康度**：
   - 所有新增/重构 React 组件行数严格 `≤ 300` 行；
   - `src/core` 单元测试覆盖全部新增引擎的正常路径、边界空值与异常输入；
   - 旧工作区打开、编辑、保存后，`conformance` 黄金测试 100% 绿灯。
