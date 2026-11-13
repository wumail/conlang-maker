# Conlang Maker 核心产品力跃升 · 第一轮终审收敛修复执行手册（REMEDIATION PLAN）

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v1.1（含 GLM-5.3 总控 + 6 路零冲突 DeepSeek 子代理并行编排方案） |
| 日期 | 2026-11-13 |
| 关联规格与日志 | [PRD.md](./PRD.md)、[EXECUTION_PLAN.md](./EXECUTION_PLAN.md)、[EXECUTION_LOG.md](./EXECUTION_LOG.md) |
| 目标执行者 | **模式 A（推荐，最快且高质）**：GLM-5.3 总控 + 6 个并发 DeepSeek v4.1 Flash 子代理（见 **§3**）<br>**模式 B（单代理备选）**：单实例按 `F1 → F5` 串行执行 |
| 二次终审者 | Antigravity |

---

## 0. 执行死命令（动工前必读）

1. **禁止“写注释绕过功能”**：首轮终审打回的核心原因是多处实现采取了“跳过 `feature_mode`”、“加 `#[serde(skip_serializing)]` 屏蔽既有字段”、“只接入单个预览组件而漏掉全链路主干”的捷径。本手册已将每一处修复的**精确文件、行号、函数签名与代码写法**全部锁死，**必须 100% 原样贯通，严禁再次留白或写注释跳过**！
2. **禁止提交 `.workbuddy/`**：`.gitignore` 已加入 `.workbuddy/` 且已从暂存区移出。后续所有操作严禁 `git add -f .workbuddy`，提交前必须满足 `test -z "$(git ls-files .workbuddy)"`。
3. **继续严守全部工程红线**：
   - `tests/golden/*.json` **零字节修改**（`git diff tests/golden/` 必须为空）；
   - 所有新建或修改的 `.tsx` 文件行数严格 `≤ 300` 行（特别警惕临界文件：`CommandPalette.tsx` 299行、`PullSync.tsx` 299行、`GlyphAnnotationPopover.tsx` 297行、`ClauseBuilderCard.tsx` 278行——增改逻辑必须拆分子组件或移入 hook/util，绝不可破 300 行！）；
   - 零 `any`、零空 `catch`、`src/core` 零外部依赖（`bun run core:check` 通过）、`en.ts`/`zh.ts` 零缺键零僵尸键（`node scripts/i18n-check.mjs` 0 错误 0 警告）。
4. **验证门禁（`V-ALL-R2`）**：
   - **若采用 §3「GLM-5.3 总控 + 6 路 DeepSeek 并行」模式**：子代理仅运行各自独占单测，**严禁子代理并发修改 `src/i18n/*`、`EXECUTION_LOG.md` 或并发跑全量 `mcp:test` / `cargo test`**；待 6 路子代理全部返回后，由 **GLM-5.3 总控**统一收口 i18n 并**串行跑通以下 9 条门禁命令（`V-ALL-R2`）**及更新 [EXECUTION_LOG.md](./EXECUTION_LOG.md) **§4**。
   - **若采用单代理串行模式**：按 `F1 → F2 → F3 → F4 → F5` 顺序每包跑通以下 9 条门禁命令：

```bash
test -z "$(git ls-files .workbuddy)"
test -z "$(git diff tests/golden/)"
node scripts/i18n-check.mjs
node scripts/version-check.mjs
bun run core:check
bunx tsc --noEmit
bun test src
bun run mcp:check && bun run mcp:test
cargo test --manifest-path src-tauri/Cargo.toml
```

---

## 1. 收敛修复总表（`F1`–`F5`）

| 修复包 | 解决首轮问题 | 关联原任务 | 核心修改文件 |
| :---: | :--- | :---: | :--- |
| **F1** | 仓库清理 + 恢复 `ss01` 书写模式 + 修音系跨语言撤销覆写 Bug + 修谱系脏缓存 + 修语料建词清空全篇手工标注 Bug | T0.1, T0.4, T1.1, T1.3 | `.workbuddy/`、`src-tauri/src/commands/font.rs`、`phonoStore.ts`、`lexiconStore.ts`、`workspaceStore.ts`、`GlossingEditor.tsx` |
| **F2** | 补齐特征模式形态音位 + 全链路贯通 `morphophonology_rules` 与 `SCAProsodyContext` + 补齐 MCP 写工具 Schema | T0.4, T2.1, T2.2, T2.5 | `morphophonology.ts`、`MorphophonologySection.tsx`、`morphologyEngine.ts`、`derivationEngine.ts`、`autoGloss.ts`、`pullSync.ts`、`SCAPreview.tsx`、`mcp/tools/{phonology,grammar_sandbox,sca,concepts}.ts` |
| **F3** | 修复 HarfBuzz WASM 内存泄漏 + 支持人造文字（多连通轮廓 + `glyph_annotations` `hb.shape`）附标净距 + 补齐横向占比 `widthStats` 与 `LSB/RSB` 垂直标尺 | T3.1, T3.2 | `harfbuzzClient.ts`、`mcp/font/{loader,shaper,outline}.ts`、`fontGeometryAudit.ts`、`mcp/tools/audit.ts`、`GlyphCellRuler.tsx`、`GlyphAnnotationPopover.tsx` |
| **F4** | 修复出版级专著本族文字 `font_input`/`font_features`/`.conlang` 渲染 + 移除旧乱码 `jspdf` + 补全语法词缀全字段同步与句法台本族字/核心标记 | T2.6, T3.3, T3.4 | `referenceBookBuilder.ts`、`ReferenceBookModal.tsx`、`ExportImport.tsx`、`grammarPullSync.ts`、`GrammarSyncModal.tsx`、`phraseSandbox.ts`、`sandbox.ts`、`ClauseBuilderCard.tsx` |
| **F5** | 补齐核心概念库 LJ-100 缺项与 `concepticon_id` + 修同源矩阵借词继承断组与补词 IPA + 修质检/DSL/Cmd+K 细节并更新日志状态 | T0.2, T0.3, T1.4, T1.5, T2.2, T2.3, T2.4 | `core_concepts.ts`、`conceptMigration.ts`、`cognateMatrix.ts`、`crossLanguageWord.ts`、`CognateMatrixTable.tsx`、`qualityCheck.ts`、`syllabifier.ts`、`ruleDsl.ts`、`CommandPalette.tsx` |

---

## 2. 逐批次零推理执行明细

### F1：高危数据安全与回归止血（最高优先级）

#### F1.1 移出已跟踪的 `.workbuddy/` 目录
- 执行命令：`git rm -r --cached --ignore-unmatch .workbuddy`
- 确认 `.gitignore` 含有 `.workbuddy/`，且 `git ls-files .workbuddy` 输出为空。

#### F1.2 修复 `FontInspection` 序列化回归（恢复 `FontPanel.tsx` 的 `ss01` 选择器）
- **目标文件**：`src-tauri/src/commands/font.rs`（第 46–53 行）
- **原因**：`src/components/writing/FontPanel.tsx:287` 依赖 `inspection.substitution_features?.includes("ss01")` 渲染传统/现代模式切换，当前 `#[serde(skip_serializing)]` 导致其永远为 `undefined`。而 `tests/golden/font_inspect_*.json` 中的测试字体不含 GSUB/GPOS 表，对应的 `Vec` 为空。
- **精确改法**：将 `src-tauri/src/commands/font.rs` 第 49–52 行改为：
  ```rust
  #[serde(default, skip_serializing_if = "Vec::is_empty")]
  pub substitution_features: Vec<String>,
  #[serde(default, skip_serializing_if = "Vec::is_empty")]
  pub positioning_features: Vec<String>,
  ```
- **验证**：`cargo test --manifest-path src-tauri/Cargo.toml` 中 `t1_12_rust_read_layer_golden_conformance` 原地通过（空 `Vec` 不输出键，保持与 golden 100% 一致），且新增 1 条单测断言非空 `substitution_features: vec!["ss01".into()]` 序列化后包含 `"substitution_features":["ss01"]`！

#### F1.3 修复 `phonoStore` 跨语言撤销串台、项目切换清栈与 `coalesceKey` 粒度
- **目标文件**：`src/store/phonoStore.ts`、`src/store/workspaceStore.ts`、`src/store/lexiconStore.ts`、`src/components/lexicon/EditorPane.tsx`
- **精确改法**：
  1. 在 `src/store/phonoStore.ts` 中：
     - 在 `loadConfig` 开始处（第 586 行 `set(...)` 之前）立即执行 `phonoHistoryBaseline = null;`；
     - 在 `loadConfig` 成功拿到 `localClean` 并 `set(...)` 之后（约第 660 行），立即执行 **`phonoHistoryBaseline = structuredClone(localClean);`**！这样切换到语言 B 后的第一次编辑，`prev` 必然是语言 B 自身的初始 `localClean`，彻底根除语言 A 覆盖语言 B 的高危 Bug！
     - 在外部同步更新 `localConfig` 的分支中也同步更新 `phonoHistoryBaseline = structuredClone(nextLocal)`。
  2. 在 `src/store/workspaceStore.ts` 的 `loadWorkspace`（切换项目路径时）与 `clearWorkspace` 中调用 `clearHistory()`（来自 `src/store/undoManager.ts`）。
  3. 细化 `coalesceKey`：
     - `EditorPane.tsx` 调用 `upsertWord` 修改字段时传入字段级 key，如 `{ coalesceKey: \`lex:\${entry.entry_id}:romanized\` }`、`{ coalesceKey: \`lex:\${entry.entry_id}:sense:\${senseId}\` }`；删除词条、增删规则等离散动作**不传 `coalesceKey`**（或传 `undefined`），防止 800ms 内连删两条规则被合并成一步。
- **必补单测**：在 `undoManager.test.ts`（或新建 `phonoStore.undo.test.ts`）模拟「加载语言 A → 编辑 A → 加载语言 B → 编辑 B → 执行 `performUndo(langB)`」，断言语言 B 回退到语言 B 的初始配置而非语言 A！

#### F1.4 修复本地编辑词典/音系后 `lineageLexiconStore` 脏缓存
- **目标文件**：`src/store/lexiconStore.ts`、`src/store/phonoStore.ts`
- **精确改法**：
  - 在 `lexiconStore.ts` 的落盘成功回调（`save_word`、`delete_word`、`save_words_batch` 完成后）以及 `upsertWord`/`deleteWord` 更新内存后，调用 `invalidateLineageLexicon(projectPath, languagePath)`（来自 `src/store/lineageLexiconStore.ts`）；
  - 在 `phonoStore.ts` 的 `debouncedSave` 成功写盘后，同样调用 `invalidateLineageLexicon(projectPath, languagePath)`。

#### F1.5 修复语料抽屉建词覆盖整篇手工标注 Bug
- **目标文件**：`src/components/corpus/GlossingEditor.tsx`、`src/core/workflows/autoGloss.ts`
- **原因**：`GlossingEditor.tsx:232` 当前写的是 `onLexEntryCreated={() => runAutoGloss(corpus)}`，会把整篇文章所有行推倒重算！
- **精确改法**：
  1. 在 `src/core/workflows/autoGloss.ts` 导出纯函数 `reGlossLineUnresolvedTokens(line: GlossedLine, words: WordEntry[], grammar: GrammarConfig, phono: PhonologyConfig, cache?: AutoGlossCache): GlossedLine`：
     - 遍历该 `line.tokens`：若某个 `token` **已经手工绑定了有效词条且非空标注**（`token.linked_entry_id && token.gloss_labels && token.gloss_labels !== "?"`），**原样保留该 `token` 不动**！
     - 仅对未绑定或 `gloss_labels === "?"` / 空的 Token 重新运行单句/单词 `autoGloss` 匹配并回填 `linked_entry_id`、`morpheme_break`、`gloss_labels`、`ipa`。
  2. 在 `GlossingEditor.tsx` 中新增 `reGlossSingleLine(targetCorpus: CorpusText, lineId: string)`，仅替换 `glossed_lines` 中 `l.line_id === lineId` 的那一行并调用 `upsertCorpus`，其余所有行 100% 原封不动！将第 232 行改为 `onLexEntryCreated={() => reGlossSingleLine(corpus, line.line_id)}`。
- **必补单测**：在 `autoGloss.test.ts` 验证：第 1 行含手工自定义 `gloss_labels: "CUSTOM.GLOSS"`，第 2 行含生词 `newword`；新增词条 `newword` 后调用 `reGlossLineUnresolvedTokens` 更新第 2 行，第 1 行与第 2 行已有手工标注 100% 保留！

---

### F2：形态音位与超音段音变全链路贯通 + MCP 写通道对齐

#### F2.1 在 `morphophonology.ts` 完整实现 `feature_mode: true` 规则（严禁 `continue` 跳过！）
- **目标文件**：`src/core/engines/morphophonology.ts`、`src/components/grammar/MorphophonologySection.tsx`（注：`src/core/engines/scaEngine.ts` 已导出 `parseFeatureExpression`、`matchesFeatures`、`applyFeatureReplacement`，无需改动 `scaEngine.ts`）
- **精确改法**：
  1. 在 `morphophonology.ts` 中直接 `import { parseFeatureExpression, matchesFeatures, applyFeatureReplacement } from "./scaEngine"`。
  2. 在 `morphophonology.ts` 中删除第 248 行的 `if (rule.feature_mode) continue;`！在 `applyRuleOnce` 中支持 `rule.feature_mode === true`：
     - 目标匹配：当 `rule.target_features` 非空时，用 `matchesFeatures(tok.phoneme, rule.target_features)` 判定当前音素是否命中；
     - 语境匹配：支持在 `context_before` / `context_after` 字符串中混合书写特征块 `[+vowel, -back]`、`C`、`V`、`C*`、`+`（词素边界）、`#`（词界）！具体解析法：在 `parseEnvTokens(envStr)` 中，遇到 `[...]` 整体提取为一个 `{ kind: "feature", expr: parseFeatureExpression(bracketContent), repeat }` 节点（可支持 `[+consonant]*` 或 `C*`），匹配时跨越/校验 `boundaryBefore`（`+`）完全复用现有的游标机制！若 `rule.context_before_features` / `context_after_features` 非空且对应语境字符串为空，同步兼容单音素特征邻接匹配。
     - 替换输出：用 `applyFeatureReplacement(tok.phoneme, rule.replacement_features, [...inventory.consonants, ...inventory.vowels])` 求出替换后的目标音素并保留原 `boundaryBefore` 标记。
  3. 在 `MorphophonologySection.tsx`（保持 `≤ 300` 行，超出则拆出 `MorphophonologyRuleRow.tsx`）行内直接补齐 `disabled` 开关与 `feature_mode` 切换及特征表达式输入（复用既有 `grammar.enabled`、`sca.featureMode` 或预埋键 `grammar.morphophonology.featureMode`，**不要改动 `ruleDsl.ts`** 以保持与 `W1` 文件零交集）。
- **必补单测**：在 `morphophonology.test.ts` 新增特征级跨 `+` 边界元音和谐用例：`ev+lar` 在 `[+vowel, +back] -> [-back] / [+vowel, -back] C* + C* _` 下输出 `evler`，而词根内部不跨 `+` 的词不受影响！

#### F2.2 将 `morphophonology_rules` 贯通至全部 7 处屈折/派生/标注/沙盒调用点
- **目标文件**：
  1. `src/core/engines/morphologyEngine.ts`：
     - `inflectByDimensionValues`（约第 518 行）、`applyFusionalInflection`、`applyAgglutinativeChain`（多槽位串联时每个词缀拼接都带 `+` 跑完 `morphophonology_rules`）、`applyInflectionTypologyAware`（第 552、601 行等全部自分支）统一从 `grammarConfig.morphophonology_rules` 取规则传入 `applyInflection`！
  2. `src/core/engines/derivationEngine.ts`：`applyDerivation` 增加可选参数 `morphophonologyRules?: MorphophonologyRule[]`（或从 `grammarConfig` 读取），词缀拼接后同样执行 `applyMorphophonology`。
  3. `src/core/workflows/autoGloss.ts`：反向屈折候选生成与词形比对传入 `grammar.morphophonology_rules`。
  4. `src/core/engines/sandbox.ts`：第 66 行改为优先调用 `applyInflectionTypologyAware`（自动携带 `grammarConfig.morphophonology_rules`）。
  5. `mcp/tools/grammar_sandbox.ts`：`gram_inflect` 工具调用屈折引擎时传入 `grammar.morphophonology_rules`。
  6. GUI 组件 `InflectionMatrix.tsx`、`InflectionTest.tsx`、`InflectionHelperCard.tsx`：确保调用时传入完整 `grammarConfig`（或 `grammarConfig.morphophonology_rules`）。

#### F2.3 将超音段 `SCAProsodyContext` 贯通至全部音变调用点
- **目标文件**：
  1. `src/components/sca/SCAPreview.tsx`：① 第 96–103 行 `useMemo` 依赖数组补上 `prosodyContext`；② 第 121 行 `handleBatchApply` 调用 `applySoundChanges` **必须传入第 5 参数 `prosodyContext`**！③ `src/utils/scaPreviewPatch.ts:43` 同步支持透传 `prosodyContext`。
  2. `src/core/workflows/pullSync.ts`：`planPullSync` 参数表增加可选 `parentPhono?: PhonologyConfig`，构造 `prosodyContext` 传入第 64 行 `applySoundChanges`（GUI `PullSync.tsx` 与 MCP `lex_pull_sync` 同步传入父语言音系）。
  3. `src/core/workflows/grammarPullSync.ts`：调用 `applySoundChanges` 时若提供音系配置则传入 `prosodyContext`。
  4. `src/components/common/CommandCalcPreview.tsx`：第 47 行调用 `applySoundChanges` 补传当前语言 `prosodyContext`。
  5. `mcp/tools/sca.ts`（`sca_simulate`）与 `mcp/tools/lexicon.ts`（批量音变应用）：读取当前语言 `PhonologyConfig` 构造 `prosodyContext` 传入 `applySoundChanges`！

#### F2.4 修复 MCP 写工具 Schema 拦截与 `toolsets` 错挂
- **目标文件**：
  1. `mcp/tools/phonology.ts`（约第 873 行 `phono_update`）：将 `stress` 的 Zod 定义更新为：
     ```ts
     stress: z.object({
       position: z.enum(["initial", "ultimate", "penultimate", "antepenultimate", "weight_sensitive"]),
       domain: z.enum(["word", "entry"]),
       weight_fallback: z.enum(["initial", "penultimate", "antepenultimate"]).optional(),
     }).passthrough().nullable().optional(),
     ```
  2. `mcp/tools/grammar_sandbox.ts`（约第 1134–1186 行 `gram_update`）：在 `inputSchema` 新增可选 `morphophonology_rules: z.array(morphophonologyRuleSchema).optional()`，在 `syntax` schema 显式支持 `alignment` 与 `case_gloss_map`，更新 `hasAnySection` 与落盘合并逻辑，并补 1 条 MCP 写入 `morphophonology_rules` + `weight_sensitive` 重音的集成测试！
  3. `mcp/tools/concepts.ts`（第 141 行）：将 `concept_upsert` 的 `toolsets` 从 `["core"]` 改为 `["core", "write"]`（确保仅开启 `--toolsets write` 时可见）。

---

### F3：人造文字字形几何审计重做与 HarfBuzz WASM 内存释放

#### F3.1 根治 HarfBuzz WASM 内存泄漏（`try / finally` 强制销毁）
- **目标文件**：`src/utils/harfbuzzClient.ts`、`mcp/font/loader.ts`、`mcp/font/shaper.ts`
- **精确改法**：
  1. `src/utils/harfbuzzClient.ts:67-132`：在创建 `blob`、`face`、`hbFont` 后，用 `try { ... } finally { hbFont.destroy(); face.destroy(); blob.destroy(); }` 包裹全部逻辑（若用了临时 `hb.Buffer` 也在内层 `try/finally` 中 `buf.destroy()`）！
  2. `mcp/font/loader.ts:160-210`：在校验失败 `throw` 分支前销毁已创建的 `hbFont` / `hbFace` / `hbBlob`。
  3. `mcp/font/shaper.ts`：每次 `shape` 创建的 `buffer` 在 `finally` 中调用 `buffer.destroy()`。

#### F3.2 让字形审计真正适配人造文字（支持单字多连通轮廓分离 + `glyph_annotations` `hb.shape` 组合 + 修复 `markGid` 键冲突）
- **目标文件**：`src/core/engines/fontGeometryAudit.ts`、`src/utils/harfbuzzClient.ts`、`mcp/font/outline.ts`、`mcp/tools/audit.ts`
- **背景**：人造文字（如音节文字/元音附标文字 Abugida）普遍将字母映射在 ASCII 或 PUA 区，要么①**在单个字形内画了左侧主干轮廓 + 右上角分离的附标轮廓**，要么②**靠 OpenType `GSUB/GPOS` 把 `base` 码位 + `vowel/mark` 码位拼合**，根本不会用拉丁字母的 Unicode NFD（`é`）！
- **精确三层检测方案**：
  1. **修复键冲突（`fontGeometryAudit.ts:426`）**：`gapByComposite` 的键必须改为 `pair.compositeGid`（当存在真实组合字形 GID 时）或按目标行 `gid` 聚合最小净距，**严禁仅以 `pair.markGid` 为键导致同一附标在多个基字上的测量值互相覆盖**！
  2. **新增「单字内部离群附标子轮廓净距检测」（`fontGeometryAudit.ts` 纯函数内直接生效）**：
     - 在分析非空字形的闭合子路径 `subpaths: Point[][]` 时，先按外接矩形重叠或包含关系将子路径聚为连通墨迹块 `Component[]`（例如 `O` 的内外圈重叠属于同一主干块）；
     - 若某字形（排除 `kind === "punctuation"`）包含 `≥ 2` 个互不重叠的连通块，且主块（面积/高度最大者）占主体，而右侧/上方存在次级小块（宽度 `< 0.45 * advanceWidth` 且高度 `< 0.65 * 主块高度`，其 `minX >= 主块 minX + 0.4 * 主块宽度`）：自动将该次级块识别为**内嵌附标块**，直接用同一套 5 条水平扫描线求主块右缘与该附标块左缘的 `opticalGapX`！
  3. **新增基于 `PhonologyConfig.glyph_annotations` 的分类与 `hb.shape` 配对（`harfbuzzClient.ts` & `mcp/tools/audit.ts`）**：
     - 读取当前语言的生效 `glyph_annotations`（若无则回退原逻辑）：
       - `GlyphOutlineInput` 新增可选字段 `glyphKind?: GlyphKind`（`"base" | "vowel" | "carrier" | "mark" | "punctuation"`）；
       - `isMark` 判定升级为：`glyphKind === "mark" || glyphKind === "vowel" || (无标注时原 isCombiningMark)`；
       - 计算基线/上缘中位数与超调异常时，**排除 `glyphKind === "punctuation"` 与独立 `isMark` 字形**，防止标点竖线/句号污染基线统计！
     - 当存在 `base/carrier` 码位集合 $B$ 与 `vowel/mark` 码位集合 $M$ 时，抽样前 `min(|B| * |M|, 120)` 对 `(b, m)` 喂入 `hb.shape`：
       - 若 `hb.shape` 输出单个连字 `ligGid`（GSUB 替换），加入 `markPairs.push({ compositeGid: ligGid, baseGid, markGid })`；
       - 若 `hb.shape` 输出 2 个字形（GPOS 定位），根据 `pos[0].x_advance + pos[1].x_offset` 与 `pos[1].y_offset` 平移附标子路径，计算真实排版后的 `opticalGapX`！

#### F3.3 补齐横向宽度占比分布与边距一致性统计（`widthStats`）
- **目标文件**：`src/core/engines/fontGeometryAudit.ts`、`mcp/tools/audit.ts`
- **精确数据结构**（挂在 `FontGeometryAuditResult.widthStats` 并由 MCP `font_audit_geometry` 一并返回 `width_stats` + 分类异常数组 `baseline_outliers` / `optical_gap_outliers` / `stem_weight_outliers`）：
  ```ts
  export interface DistributionStats {
    count: number;
    min: number;
    max: number;
    mean: number;
    stdDev: number;
  }
  export interface WidthConsistencyStats {
    baseAdvanceRatio: DistributionStats | null; // base/carrier 的 (inkMaxX - inkMinX) / advanceWidth
    markAdvanceRatio: DistributionStats | null; // vowel/mark 的 (inkMaxX - inkMinX) / advanceWidth
    lsb: DistributionStats | null;
    rsb: DistributionStats | null;
  }
  ```

#### F3.4 补齐 `LSB / RSB` 垂直标尺线与单字放大镜标尺
- **目标文件**：`src/components/writing/GlyphCellRuler.tsx`、`src/components/writing/GlyphAnnotationPopover.tsx`（或单字详情区）
- **精确改法**：`GlyphCellRuler` 新增可选 `lsbRatio?: number` 与 `rsbRatio?: number`（由对应 `GlyphAuditRow` 的 `inkMinX / upm`、`inkMaxX / upm` 传入），在 SVG 内增加两条纵向虚线标示字形左右墨迹边界与字宽框；单字放大检视弹窗同步支持显示该标尺叠加层。

---

### F4：出版级专著本族字连字修复、下线旧 `jspdf`、补全语法同步与短语句法台

#### F4.1 修复 `referenceBookBuilder.ts` 本族文字渲染并移除旧乱码 PDF 入口
- **目标文件**：`src/core/engines/referenceBookBuilder.ts`、`src/components/export/ReferenceBookModal.tsx`、`src/pages/ExportImport.tsx`、`src/utils/exportPDF.ts`
- **精确改法**：
  1. 在 `referenceBookBuilder.ts` 中导入纯引擎 `buildFontInputIndex`、`wordToFontText`、`textToFontText`（来自 `./fontInput`）与 `fontFeaturesToCss`（来自 `./fontLayout`）：
     - `@font-face` 格式自适应：若 `fontMime === "font/otf"` 或文件名 `.otf` 使用 `format("opentype")`，否则 `format("truetype")`；
     - 在 `.conlang` CSS 类上注入 `font-feature-settings: ${fontFeaturesToCss(options.phono.font_features ?? [])};`；
     - 构建 `fontIndex = options.phono.font_input ? buildFontInputIndex(options.words, options.grammar, options.phono) : null`；
     - **Part I 词典词头**：同时输出 `<span class="conlang native-headword">${escapeHtml(nativeScript)}</span> <span class="headword">${escapeHtml(word.con_word_romanized)}</span>`，并补上绑定的概念名徽章、简要词源（如 `< 祖语词`）与首条非空例句；
     - **语料选集原文行与范式表单元格**：若有 `fontBase64`，上方渲染一行 `.conlang` 本族文字（经 `textToFontText` / `wordToFontText` 转换），下方渲染罗马字、词素拆解、gloss 与自由意译；
     - **Part II 反向索引**：遍历每个词条的**全部 `word.senses`**（不再只取 `senses[0]`！），以 `sense.gloss`（及绑定的概念中英文名）生成反向检索项并按字母/拼音排序。
  2. `ReferenceBookModal.tsx:125,136`：将手写的 `"btn btn-ghost btn-xs..."` 替换为 `src/lib/ui.ts` 中的按钮样式常量。
  3. **清理旧版乱码 `jspdf` 卡片（`ExportImport.tsx:170-182`）**：将原第一个红色「PDF 导出（`handleExportPDF`）」卡片直接替换为打开 `ReferenceBookModal`（《参考语法与双向词典》HTML / 矢量 PDF / Typst 导出）的主入口卡片，删除 `ExportImport.tsx` 对 `exportPDF.ts` 的导入与死代码（若 `src/utils/exportPDF.ts` 已无任何引用，同步删除该文件，顺带消灭其中 3 处历史 `as any`！注意检查并同步清理不再使用的 i18n 键，保持 `i18n-check` 0 警告）。

#### F4.2 补齐 `grammarPullSync` 全词缀字段演化与 GUI 快照保护
- **目标文件**：`src/core/workflows/grammarPullSync.ts`、`src/store/grammarStore.ts`、`src/components/tree/GrammarSyncModal.tsx`
- **精确改法**：
  1. 在 `grammarPullSync.ts` 中，对每条 `sca_mutable !== false` 的 `InflectionRule` 与 `DerivationRule`，不仅演化 `rule.affix`，**同步演化并预览应用以下全部词缀子字段**（复用 `patchRuleWithSca` 同构逻辑）：
     - `condition.then_affix`、`condition.else_affix`
     - `infix_config.morpheme`
     - `circumfix_config.prefix_part`、`circumfix_config.suffix_part`
     - `ablaut_config.target_vowel`、`ablaut_config.replacement_vowel`
  2. 在 `src/store/grammarStore.ts` 新增原子方法 `applyGrammarSyncPatch: (patch: Pick<GrammarConfig, "inflection_rules" | "derivation_rules" | "irregular_overrides">) => void`，内部只调用**一次** `applyEdit` 合并写入三组规则，使 `Cmd+Z` 只需按 **1 次**即可完整撤回整次语法同步（而非分 3 步）！
  3. 在 `GrammarSyncModal.tsx` 点击确认应用前，完全对齐 `PullSync.tsx:121-131` 先建立语法快照恢复点，再调用 `applyGrammarSyncPatch`：
     ```ts
     const opId = generateOperationId();
     recordGuiOperationId(opId);
     await invoke<OperationLog>("create_snapshot", {
       projectPath,
       languagePath: childLang.path,
       operationType: "grammar_sync",
       sourceLanguageId: parentLang.language_id,
       targetLanguageId: childLang.language_id,
       description: `Synced ${selectedKeys.size} grammar rule(s) via sound changes`,
       scope: "grammar",
       origin: "gui",
       operationId: opId,
     });
     ```

#### F4.3 补齐短语句法台本族文字 `<ScriptLine />`、`head_marking` 与 `number / polarity`
- **目标文件**：`src/core/engines/phraseSandbox.ts`、`src/components/sandbox/ClauseBuilderCard.tsx`、`src/components/sandbox/NPBuilderRow.tsx`、`mcp/tools/grammar_sandbox.ts`
- **精确改法**：
  1. `NPNode` 补齐 `number?: string`（如 SG/PL 维度值 gloss），`ClauseNode` 补齐 `polarity?: "affirmative" | "negative"`（否定极性自动查找 gloss 为 `NEG` 的动词词缀或独立否定小词）；
  2. 支持 `grammar.typology.head_marking`：
     - `"dependent"`（默认）：格标记打在 NP 中心名词上（若语法中形容词词性也适用同一格/数维度，同步协变赋给 `ADJ`）；
     - `"head"`：论元格标记不打在名词上，改为汇入动词 `V` 的标签链；
     - `"double"`：名词与动词双标；
     - `"none"`：不自动注入格标记（纯靠语序/介词）。
  3. `ClauseBuilderCard.tsx` 输出结果区顶部增加 `<ScriptLine text={surfaceSentence} />`（展示连字渲染后的本族文字整句），下方展示罗马字、IPA 与对齐标注块（严守组件 `≤ 300` 行，可将输出区拆为 `SandboxResultCard.tsx`）。
  4. MCP `sandbox_translate` 的 `clause` Zod schema 同步补上 `number` 与 `polarity`。

---

### F5：概念库补全、同源矩阵与质检/DSL/Cmd+K 细节打磨

#### F5.1 音节切分器、词典质检与罗马化行内索引精修（`T0.2`、`T0.3`）
- `src/core/engines/syllabifier.ts`：当某音素含长音符 `ː`（如 `aː`）且 `unit.allowed` 未直接收录 `aː` 但收录了基础元音 `a` 时，允许剥离 `ː` 回退匹配槽位，并保留原 token `aː` 以正确判定 `heavy` 音重！同时支持多字符宏名（如用花括号 `{CL}` 或优先匹配已知宏键）。
- `src/core/engines/qualityCheck.ts`：
  - `vowelHarmonyViolation`：若 `word.etymology.components` 含有 `≥ 2` 个指向本语言词根（`relation === "root" | "head" | "modifier"` 且有对应词条）的复合词，跳过整词混检（各成分词根自身已单独受检），消除复合词误报！
  - `homophonyClash`：构建同音分组时按 `entry_id` 去重（`Set<string>`），防止同一词条有多个同 `pos_id` 义项时重复刷出多条相同告警。
- `src/components/phonology/RomanizationLintBanner.tsx`：`buildRuleLintIndex` 补入 `analysis.duplicate_rules`，并以 `${map_id}::${rule_id}` 为键（`RuleTable.tsx` 传入当前 `map.map_id` 查询），消除多表串表与重复规则漏标黄。

#### F5.2 全局 `Cmd+K` 全工作区检索预热与父→子音变推演（`T1.4`）
- `src/components/common/CommandPalette.tsx`：面板打开（`open === true`）时，在 `useEffect` 中遍历 `workspaceConfig.languages`，对尚未进入缓存的语言后台调用 `loadLineageLexicon` 预热，使未手动点开过的子语言词条也能被秒搜！
- `src/components/common/CommandCalcPreview.tsx`：若当前语言在 `workspaceConfig.languages` 中存在直接子语言（`lang.parent_id === activeLanguageId`），异步读取首个（或最多前 3 个）直接子语言的 `sca.json` 展示真实的「父 → 子音变推演预览」（无子语言时保留当前自身 `scaConfig` 推演，且统一传入 `prosodyContext`）。

#### F5.3 规则 DSL 注释解析与清空支持（`T1.5`）
- `src/core/engines/ruleDsl.ts`：修复第 65 行 `#` 说明切分逻辑——在规则的 `/ <before> _ <after>` 与 `! <exceptions>` 之后出现的 ` # `（前带空白的 `#`）无论说明文字内是否包含 `_` 或 `/`（如 `# voiced_stop`、`# C/V`），一律识别为说明注释，只有紧邻 `_` 且后面还有 `_` 的 `#` 才视为词界符！
- `src/components/common/RuleDslEditor.tsx`：当文本域仅含空白/注释且 `diagnostics.length === 0` 时，允许点击「应用到表单」（清空规则集），不再强制要求 `result.rules.length > 0`。

#### F5.4 补齐 `core_concepts.ts` 的 100 条 Leipzig-Jakarta 完整度、`concepticon_id` 与安全迁移（`T2.2`）
- `src/data/core_concepts.ts`：补齐缺失的 **14 条 Leipzig-Jakarta 100** 概念（确保过滤 `standard_lists.includes("leipzig_jakarta_100")` 精确等于 `100` 条，`swadesh_100` 精确等于 `100` 条！），并为所有标准核心概念填入真实 Concepticon ID（如 `"I" -> "1209"`, `"WATER" -> "948"`, `"FIRE" -> "221"`, `"SUN" -> "1343"`, `"NAME" -> "1405"` 等标准编号；可通过单元测试断言 `CORE_CONCEPTS` 中 Swadesh-100 与 LJ-100 计数各为 100 且 `concepticon_id` 非空）。
- `src/core/workflows/conceptMigration.ts`：对于纯数字编号标签（如 `概念071`），**禁止静默当成 `resolved` 自动绑定 `SWADESH_100` 下标**！将其状态归为 `"needs_confirm"`（或在 `ConceptMigrationModal` 中默认不勾选纯数字猜测项，显式标黄提示「按序号猜测，请核对词义后再勾选」），只有 `概念:水` / `concept:water` 这类语义精确匹配才自动勾选！统一 `ConceptPicker` 与 `conceptMigration` 的自定义 ID 生成函数。

#### F5.5 修复同源词矩阵借词继承链、跨语言补词 IPA 与单元格本族字（`T2.3`）
- `src/core/engines/cognateMatrix.ts`：`traceRoot()` 沿 `parent_entry_id` 向上追溯时，若到达某祖先节点 `X` 其 `origin_type === "borrowed"` 且无更上层本语系 `parent_entry_id`，则整条继承自 `X` 的子孙词链统一共享同一个 `cognateSetId = "borrowed::" + langX + "::" + entryX`（这样父语言借入某词并演化传给 3 个子语言时，这 4 门语言在矩阵中会正确显示为同一借词源同源组，而不会分裂成两组！）。
- `src/utils/crossLanguageWord.ts`：`createWordInLanguage` 读取目标语言的 `PhonologyConfig` 与 `GrammarConfig`（优先取目标语言的首个 `pos_id` 而非当前激活语言的 `posId`！），调用 `generateIPA` 计算真实的 `phonetic_ipa` 后再 `save_word`；若 `targetLanguageId === activeLanguageId`，直接走 `useLexiconStore.getState().upsertWord` 以同步更新当前视图与撤销栈！同时修 `CognateMatrix.tsx:78` `concept_id.toLowerCase().includes(needle)`。
- `src/components/tree/CognateMatrixTable.tsx`：非空单元格在罗马字旁（或次行紧凑字号）增加 `/IPA/` 简显，对当前激活语言列渲染 `<ScriptLine />` 本族字预览。

#### F5.6 词源下拉补全与最终收官自检（`T2.4` & 日志闭环）
- `src/components/lexicon/WordEtymologySection.tsx`：`origin_type` 下拉框补齐缺失的 `"derived"` 与 `"mixed"` 选项；当 `wordFamily` 计算发现当前词条 `stale === true`（上游成分读音已变）时，在 `WordComponentsEditor` 顶部展示醒目的黄色过期提示条与「一键同步核验摘要」按钮。
- 全部跑通 **§0 `V-ALL-R2` 九条验证命令**，确认 `EXECUTION_LOG.md` 的 **§1 备注** 与 **§4 收敛修复表** 全部更新完毕。

---

## 3. GLM-5.3 总控 + 6 路零冲突 DeepSeek 子代理并行编排规范（推荐）

> **核心结论**：**不能**直接把 `F1`–`F5` 原样并发（`autoGloss.ts`、`grammarPullSync.ts`、`CommandCalcPreview.tsx`、`grammar_sandbox.ts` 与 `src/i18n/{en,zh}.ts` 会发生跨包写覆盖，且并发跑 `mcp:test` 会争抢跨进程文件锁）。
> **但按物理文件所有权重新切分为以下 `Phase 0 → W1..W6 → Phase 2` 三阶段后，6 个并发子代理的修改文件集合两两交集严格为 `∅`（100% 零重叠），且跨模块函数签名（`applyInflection`、`applyInflectionTypologyAware`、`applySoundChanges`）与 `src/types/index.ts` 已在代码库中冻结就绪，无需互相等待即可高质量并发完成！**

### 3.1 全局铁律（GLM-5.3 派发子代理时必须写进每个子代理 Prompt）

1. **总控独占文件（任何子代理 `W1`–`W6` 绝对禁止写入）**：
   - `src/i18n/en.ts`、`src/i18n/zh.ts`（由 GLM-5.3 在 Phase 0 预埋、Phase 2 统一收口）；
   - `src/types/index.ts`（所需全部类型均已存在，零修改需求）；
   - `design/roadmap-v2/*`（含 `EXECUTION_LOG.md`）；
   - `tests/golden/*`、`.gitignore`、任何 `git` 命令（禁止子代理执行 `git add` / `git commit` / `git checkout` / `git reset`）。
2. **文件白名单硬隔离**：每个子代理**只允许编辑或新建分配给它白名单内的文件**；严禁顺手格式化或改动白名单外的任何文件。
3. **验证命令隔离**：子代理工作期间**严禁运行** `bun run mcp:test`、`node scripts/i18n-check.mjs` 或全仓 `bun test src`（避免并发跨进程锁冲突或读到兄弟代理写到一半的文件）；每个子代理只运行下方分配给它的**独立单测文件命令**。
4. **300 行红线硬校验**：子代理结束前必须对自己白名单内所有 `.tsx` 文件执行 `wc -l`，确保**无一超过 `300` 行**！

---

### 3.2 Phase 0：GLM-5.3 总控前置动作（串行，约 1 分钟）

在启动 `W1`–`W6` 之前，GLM-5.3 亲自执行以下两步：

1. **确认 `.workbuddy/` 已脱管（`F1.1`）**：
   执行 `git rm -r --cached --ignore-unmatch .workbuddy` 并确认 `test -z "$(git ls-files .workbuddy)"` 通过。
2. **在 `src/i18n/en.ts` 与 `src/i18n/zh.ts` 集中预埋本轮子代理所需的双语键**（使 `W1`–`W6` 可直接 `t("...")` 调用而无需碰 `src/i18n/*`）：
   - `lexicon.originDerived`: `"Derived"` / `"派生"`
   - `lexicon.originMixed`: `"Mixed"` / `"混合"`
   - `lexicon.family.staleWarning`: `"Upstream component pronunciation changed — review and re-verify"` / `"上游词素读音已变更，请核对后重新同步摘要"`
   - `grammar.morphophonology.featureMode`: `"Feature mode"` / `"特征模式"`
   - `sandbox.clause.number`: `"Number"` / `"数"`
   - `sandbox.clause.polarity`: `"Polarity"` / `"极性"`
   - `sandbox.clause.affirmative`: `"Affirmative"` / `"肯定"`
   - `sandbox.clause.negative`: `"Negative"` / `"否定"`
   - `sandbox.clause.nativeScript`: `"Native script"` / `"本族文字"`
   - `writing.geometry.baseWidthRatio`: `"Base width ratio"` / `"基字宽度占比"`
   - `writing.geometry.markWidthRatio`: `"Mark width ratio"` / `"附标宽度占比"`
   - `writing.geometry.sideBearings`: `"LSB / RSB"` / `"左右边距 (LSB / RSB)"`
   - `concept.migration.status.needsConfirm`: `"numeric guess (confirm)"` / `"序号猜测（需核对）"`
   - `concept.migration.needsConfirmHint`: `"Guessed by Swadesh index — verify meaning before checking"` / `"按 Swadesh 序号猜测，请核对词义后再勾选"`

> 注：若某个子代理在实现中未使用上述某条预埋键、或汇报了额外需要的键名，GLM-5.3 在 **Phase 2** 收口阶段统一增删校准。

---

### 3.3 Phase 1：6 路零重叠 DeepSeek 子代理并发分片表（`W1`–`W6`）

GLM-5.3 同时派发以下 **6 个互不相交的 DeepSeek 子代理**：

#### 子代理 `W1`：状态防串台、脏缓存失效、Rust 字体特性、词源/罗马化/DSL/`Cmd+K`
- **负责条目**：`F1.2` + `F1.3` + `F1.4` + `F5.1`（仅 `RomanizationLintBanner` / `RuleTable` 部分）+ `F5.2`（含 `CommandCalcPreview` 传入 `prosodyContext`）+ `F5.3` + `F5.6`（UI 部分）
- **独占可写文件白名单（严禁越界）**：
  - `src-tauri/src/commands/font.rs`
  - `src/store/phonoStore.ts`
  - `src/store/lexiconStore.ts`
  - `src/store/workspaceStore.ts`
  - `src/store/undoManager.test.ts`（或新建 `src/store/phonoStore.undo.test.ts`）
  - `src/components/lexicon/EditorPane.tsx`
  - `src/components/lexicon/WordEtymologySection.tsx`
  - `src/components/lexicon/WordComponentsEditor.tsx`
  - `src/components/phonology/RomanizationLintBanner.tsx`
  - `src/components/phonology/RuleTable.tsx`
  - `src/core/engines/ruleDsl.ts`、`src/core/engines/ruleDsl.test.ts`、`src/components/common/RuleDslEditor.tsx`
  - `src/components/common/CommandPalette.tsx`（**现 299 行预警**：预热逻辑必须写进 `src/lib/commandPalette.ts` 或 `src/lib/useCommandPaletteHotkey.ts`，保持 `.tsx ≤ 300` 行！）、`src/components/common/CommandCalcPreview.tsx`、`src/lib/commandPalette.ts`、`src/lib/commandPalette.test.ts`、`src/lib/useCommandPaletteHotkey.ts`
- **子代理本地自测命令**：
  ```bash
  bun test src/store/undoManager.test.ts src/core/engines/ruleDsl.test.ts src/lib/commandPalette.test.ts
  cargo test --manifest-path src-tauri/Cargo.toml font
  wc -l src/components/lexicon/EditorPane.tsx src/components/lexicon/WordEtymologySection.tsx src/components/lexicon/WordComponentsEditor.tsx src/components/phonology/RomanizationLintBanner.tsx src/components/phonology/RuleTable.tsx src/components/common/RuleDslEditor.tsx src/components/common/CommandPalette.tsx src/components/common/CommandCalcPreview.tsx
  ```

#### 子代理 `W2`：特征形态音位、屈折/派生/语料/谱系超音段全链路贯通与音系 MCP
- **负责条目**：`F1.5` + `F2.1` + `F2.2`（不含 `sandbox.ts` / `InflectionHelperCard.tsx` / `grammar_sandbox.ts`，这三处归 `W3`）+ `F2.3`（不含 `CommandCalcPreview.tsx`，该处归 `W1`）+ `F2.4`（仅 `mcp/tools/phonology.ts`）+ `F4.2`
- **独占可写文件白名单（严禁越界）**：
  - `src/core/engines/morphophonology.ts`、`src/core/engines/morphophonology.test.ts`
  - `src/components/grammar/MorphophonologySection.tsx`（及可选拆出的新建 `src/components/grammar/MorphophonologyRuleRow.tsx`；**禁止触碰 `ruleDsl.ts`**）
  - `src/core/engines/morphologyEngine.ts`（保持对外导出函数签名向后兼容！）、`src/core/engines/morphologyEngine.test.ts`
  - `src/core/engines/derivationEngine.ts`
  - `src/components/grammar/InflectionMatrix.tsx`、`src/components/grammar/InflectionTest.tsx`
  - `src/core/workflows/autoGloss.ts`、`src/core/workflows/autoGloss.test.ts`、`src/components/corpus/GlossingEditor.tsx`
  - `src/components/sca/SCAPreview.tsx`、`src/utils/scaPreviewPatch.ts`
  - `src/core/workflows/pullSync.ts`、`src/core/workflows/pullSync.test.ts`、`src/components/tree/PullSync.tsx`（**现 299 行预警**：必须精简或抽出小展示子组件，严禁超过 `300` 行！）
  - `src/core/workflows/grammarPullSync.ts`、`src/core/workflows/grammarPullSync.test.ts`、`src/store/grammarStore.ts`、`src/components/tree/GrammarSyncModal.tsx`
  - `mcp/tools/phonology.ts`、`mcp/tools/sca.ts`、`mcp/tools/lexicon.ts`、新建 `mcp/tests/p2-prosody-sync.test.ts`
- **子代理本地自测命令**：
  ```bash
  bun test src/core/engines/morphophonology.test.ts src/core/engines/morphologyEngine.test.ts src/core/workflows/autoGloss.test.ts src/core/workflows/pullSync.test.ts src/core/workflows/grammarPullSync.test.ts
  wc -l src/components/grammar/MorphophonologySection.tsx src/components/grammar/InflectionMatrix.tsx src/components/grammar/InflectionTest.tsx src/components/corpus/GlossingEditor.tsx src/components/sca/SCAPreview.tsx src/components/tree/PullSync.tsx src/components/tree/GrammarSyncModal.tsx
  ```

#### 子代理 `W3`：递归短语句法台 `head_marking`/`number`/`polarity`/`<ScriptLine />` 与语法沙盒 MCP
- **负责条目**：`F4.3` + `F2.2`（`sandbox.ts`、`InflectionHelperCard.tsx`、`mcp/tools/grammar_sandbox.ts` 部分）+ `F2.4`（`mcp/tools/grammar_sandbox.ts` `gram_update` 支持 `morphophonology_rules` / `alignment` / `case_gloss_map` 部分）
- **独占可写文件白名单（严禁越界）**：
  - `src/core/engines/phraseSandbox.ts`、`src/core/engines/phraseSandbox.test.ts`
  - `src/core/engines/sandbox.ts`
  - `src/components/sandbox/ClauseBuilderCard.tsx`（**现 278 行预警**：必须将结果预览拆为新建 `src/components/sandbox/SandboxResultCard.tsx`，确保两文件均 `≤ 300` 行！）
  - `src/components/sandbox/NPBuilderRow.tsx`
  - `src/components/sandbox/InflectionHelperCard.tsx`
  - 新建 `src/components/sandbox/SandboxResultCard.tsx`
  - `mcp/tools/grammar_sandbox.ts`、新建 `mcp/tests/phrase-sandbox-r2.test.ts`
- **子代理本地自测命令**：
  ```bash
  bun test src/core/engines/phraseSandbox.test.ts
  wc -l src/components/sandbox/*.tsx
  ```

#### 子代理 `W4`：HarfBuzz WASM 内存安全释放与人造文字字形几何审计重做
- **负责条目**：`F3.1` + `F3.2` + `F3.3` + `F3.4`
- **独占可写文件白名单（严禁越界）**：
  - `src/utils/harfbuzzClient.ts`
  - `mcp/font/loader.ts`、`mcp/font/shaper.ts`、`mcp/font/outline.ts`
  - `src/core/engines/fontGeometryAudit.ts`、`src/core/engines/fontGeometryAudit.test.ts`
  - `mcp/tools/audit.ts`、新建 `mcp/tests/font-geometry-r2.test.ts`
  - `src/components/writing/GlyphCellRuler.tsx`
  - `src/components/writing/GlyphGeometryInspector.tsx`
  - `src/components/writing/GlyphAnnotationPopover.tsx`（**现 297 行预警**：必须将字形放大预览及标尺区拆为新建 `src/components/writing/GlyphZoomPreview.tsx`，严禁超过 `300` 行！）
  - 新建 `src/components/writing/GlyphZoomPreview.tsx`
- **子代理本地自测命令**：
  ```bash
  bun test src/core/engines/fontGeometryAudit.test.ts
  wc -l src/components/writing/GlyphCellRuler.tsx src/components/writing/GlyphGeometryInspector.tsx src/components/writing/GlyphAnnotationPopover.tsx
  ```

#### 子代理 `W5`：出版级参考语法专著本族文字修复、下线旧 `jspdf`、音节与质检引擎精修
- **负责条目**：`F4.1` + `F5.1`（`syllabifier.ts` 与 `qualityCheck.ts` 引擎部分）
- **独占可写文件白名单（严禁越界）**：
  - `src/core/engines/referenceBookBuilder.ts`、`src/core/engines/referenceBookBuilder.test.ts`
  - `src/components/export/ReferenceBookModal.tsx`
  - `src/pages/ExportImport.tsx`
  - 删除 `src/utils/exportPDF.ts`（注意：**不要改 `src/i18n/*`**，删除 `exportPDF.ts` 后遗留的 `export.pdf` / `export.pdfDesc` / `export.downloadPDF` 三个废弃翻译键由 GLM-5.3 在 Phase 2 统一移除！）
  - `src/core/engines/syllabifier.ts`、`src/core/engines/syllabifier.test.ts`
  - `src/core/engines/qualityCheck.ts`、`src/core/engines/qualityCheck.test.ts`
- **子代理本地自测命令**：
  ```bash
  bun test src/core/engines/referenceBookBuilder.test.ts src/core/engines/syllabifier.test.ts src/core/engines/qualityCheck.test.ts
  wc -l src/components/export/ReferenceBookModal.tsx src/pages/ExportImport.tsx
  ```

#### 子代理 `W6`：核心概念库 LJ-100 与 Concepticon 补全、安全数字标签迁移、同源矩阵与跨语言补词
- **负责条目**：`F2.4`（仅 `mcp/tools/concepts.ts` `"write"` toolset）+ `F5.4` + `F5.5`
- **独占可写文件白名单（严禁越界）**：
  - `src/data/core_concepts.ts`、新建 `src/data/core_concepts.test.ts`
  - `src/core/workflows/conceptMigration.ts`、`src/core/workflows/conceptMigration.test.ts`
  - `src/components/common/ConceptPicker.tsx`、`src/components/lexicon/ConceptMigrationModal.tsx`
  - `mcp/tools/concepts.ts`
  - `src/core/engines/cognateMatrix.ts`、`src/core/engines/cognateMatrix.test.ts`
  - `src/pages/CognateMatrix.tsx`、`src/components/tree/CognateMatrixTable.tsx`
  - `src/utils/crossLanguageWord.ts`
- **子代理本地自测命令**：
  ```bash
  bun test src/data/core_concepts.test.ts src/core/workflows/conceptMigration.test.ts src/core/engines/cognateMatrix.test.ts
  wc -l src/components/common/ConceptPicker.tsx src/components/lexicon/ConceptMigrationModal.tsx src/pages/CognateMatrix.tsx src/components/tree/CognateMatrixTable.tsx
  ```

---

### 3.4 Phase 2：GLM-5.3 总控串行合龙、门禁验算与本地提交（禁止并发）

当 `W1`–`W6` 全部返回后，**GLM-5.3 总控亲自串行执行以下 5 步**，发现任何报错则精准修补对应文件直至 **9 项全绿**：

1. **统一收口 `src/i18n/en.ts` 与 `src/i18n/zh.ts`**：
   - 移除 `W5` 下线旧版 `jspdf` 后不再使用的 `export.pdf`、`export.pdfDesc`、`export.downloadPDF`；
   - 运行 `node scripts/i18n-check.mjs`，清理未引用预埋键或补齐遗漏键，直至输出 **`0 errors, 0 warnings`**。
2. **检查全部修改过的 `.tsx` 组件行数红线**：
   - 对 `git status --short` 中所有新增/修改的 `.tsx` 运行 `wc -l`，确认每一项严格 **`≤ 300` 行**（既有未触碰的历史组件除外）。
3. **串行跑通 `V-ALL-R2` 九条全量门禁（禁止后台并发跑）**：
   ```bash
   test -z "$(git ls-files .workbuddy)"
   test -z "$(git diff tests/golden/)"
   node scripts/i18n-check.mjs
   node scripts/version-check.mjs
   bun run core:check
   bunx tsc --noEmit
   bun test src
   bun run mcp:check && bun run mcp:test
   cargo test --manifest-path src-tauri/Cargo.toml
   ```
4. **回填 [EXECUTION_LOG.md](./EXECUTION_LOG.md) §4**：
   - 将 `F1`–`F5` 执行状态更新为 `[x]`，如实填入日期、单测计数与 `V-ALL-R2` 退出码（注意保留「Antigravity 二审通过」列为 `[ ]` 留待 Antigravity 复审）。
5. **本地提交（不要 `git push`）**：
   - 再次确认 `git status` 不含 `.workbuddy/`，提交至本地仓库后交由用户通知 Antigravity 进行二次终审。

