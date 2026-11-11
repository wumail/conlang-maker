# Conlang Maker MCP 服务 · 产品需求文档（PRD）

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.3（审查修订，新增协议随实现验收） |
| 日期 | 2026-11-11 |
| 关联文档 | [BRD.md](./BRD.md) |
| 代号 | `conlang-mcp` |

---

## 0. 阅读指引

- §1–2：产品定义与现状基线（基于代码核查）
- §3：已选架构与技术方案
- §4：接口通用约定（寻址、版本、分页、错误）
- §5：工具目录（全量，按模块分组，含优先级）
- §6：字体覆盖审计的详细设计（核心功能）
- §7–8：并发与安全、GUI 侧配套改造
- §9–11：资源与 Prompts、配置与分发、非功能与测试
- §12–13：里程碑与验收标准、既有决策及本次修订

工具优先级：**P0** 为 M1 读取、计算与审计能力。**P1** 为 M2/M3 应有能力。**P2** 可选或延后。GUI 与存储安全任务按 §8、§12 标明的里程碑验收。

---

## 1. 产品定义

`conlang-mcp` 是一个本地 MCP（Model Context Protocol）服务。它通过 stdio 与 Agent 通信，把 Conlang Maker 工作区的**数据**（音系、映射、字体、词典、语法、SCA、语料、语系树）和**计算能力**（IPA 生成、音变模拟、屈折、质检、覆盖审计等）以带语义的工具、资源和 Prompt 形式暴露给 Agent。

设计原则：

1. **语义优先**：Agent 面对的是「语言 / 映射规则 / 词条」，而不是「文件 / JSON 路径」。继承链、默认映射表、`entry_id` 跨语言共享这些规则由服务处理。
2. **同源计算**：计算逻辑与 GUI 用同一份 TypeScript 代码。
3. **默认只读，写入可撤销**：写入需要显式开启，并带版本校验和自动快照。
4. **输出可控**：所有列表分页，支持字段裁剪和摘要模式，单次返回不超过约 25k tokens。
5. **与 GUI 共存**：GUI 开着也能安全使用。

## 2. 现状基线（代码核查结论）

| 领域 | 存储 | 读写实现 | 计算逻辑位置 | 备注 |
| --- | --- | --- | --- | --- |
| 注册表 | `~/Library/Application Support/com.conlang-maker/registry.json` | [registry.rs](../../src-tauri/src/commands/registry.rs) | — | 同名语系可以重复注册（本机 `lumitic-kkltbxdc` 注册了 3 次），**不能用名字当唯一键** |
| 工作区 | `<project>/*.conlang` | [workspace.rs](../../src-tauri/src/commands/workspace.rs) | — | `languages[]`：id / name / path / parent_id |
| 音系 | `<lang>/phonology.json` | [phonology.rs](../../src-tauri/src/commands/phonology.rs) | [ipaGenerator.ts](../../src/utils/ipaGenerator.ts)、[phonemeTokenizer.ts](../../src/utils/phonemeTokenizer.ts) | 读取时迁移旧版 `writing_systems`；子语言 `glyph_annotations` 为空时**继承祖先** |
| 字体 | `<lang>/font.otf\|font.ttf` | [font.rs](../../src-tauri/src/commands/font.rs)、[font_info.rs](../../src-tauri/src/commands/font_info.rs) | — | 沿 parent_id 向上找第一份字体；上限 20MB |
| 词典 | `<lang>/lexicon/lexicon_{a-z\|others}.ndjson` | [lexicon.rs](../../src-tauri/src/commands/lexicon.rs) | statistics / qualityCheck / ipaSearch / wordLifecycle | 按首字母分桶、按拼写排序；**没有释义或拼写为 `new_word` 的词条会被静默丢弃**；`entry_id` 在父子语言间保持一致 |
| 语法 | `<lang>/grammar.json` | [grammar.rs](../../src-tauri/src/commands/grammar.rs) | morphologyEngine / derivationEngine / typologyAnalyzer / sandbox | — |
| SCA | `<lang>/sca_rules.json` | [sca.rs](../../src-tauri/src/commands/sca.rs) | [scaEngine.ts](../../src/utils/scaEngine.ts)、scaImportParser | — |
| 语料 | `<lang>/corpus/{id}.json` + `corpus_index.json` | [corpus.rs](../../src-tauri/src/commands/corpus.rs) | 自动标注写在 `GlossingEditor.tsx` **组件内部** | — |
| 语系操作 | — | [fork.rs](../../src-tauri/src/commands/fork.rs) | Pull Sync 写在 [PullSync.tsx](../../src/components/tree/PullSync.tsx) **组件内部** | 派生时复制整套数据 |
| 快照 | `<lang>/.oplog/` | [oplog.rs](../../src-tauri/src/commands/oplog.rs) | — | **只备份 `lexicon/`**；删除语言时 `.oplog` 会一起被删 |
| 写入 | — | `atomic_write`（[lexicon.rs:16](../../src-tauri/src/commands/lexicon.rs#L16)） | — | 临时文件名固定为 `<file>.tmp`，**多进程同时写会互相冲突** |
| GUI 保存 | — | 各 store 防抖 500ms | — | 不感知外部变更 |

前端计算引擎约 3,800 行（含 `src/data`），只有 `llmPrompt.ts` 和 `exportDic.ts` 用到 DOM（下载 / 剪贴板）。其余都是纯函数，可以直接复用。

---

## 3. 架构与技术方案

### 3.1 方案对比

| 方案 | 描述 | 优点 | 缺点 |
| --- | --- | --- | --- |
| A. Rust 独立服务 | 新建 Rust 可执行文件，复用 `conlang_maker_lib` 存储，**用 Rust 重写全部 TS 引擎** | 单一语言；存储天然一致 | 重写约 3,800 行引擎，**GUI 与 MCP 两套实现必然分歧**，违背 G3；维护成本翻倍 |
| B. 嵌入 GUI 进程 | Tauri 进程内起本地 HTTP MCP，写入直接推给前端 store | 天然没有并发问题 | 必须开着 GUI；计算仍在 WebView 里，后端无法直接调用；生命周期复杂 |
| **C. TS 独立服务（推荐）** | 新建 Bun / Node 运行的 TS 服务，**直接 import 共享引擎**；存储层用 TS 按 Rust 语义实现，并做一致性测试；字体用 HarfBuzz（wasm） | 计算 100% 同源；不依赖 GUI；HarfBuzz 能做真实排版审计 | 存储层有两份实现，需要靠一致性测试守住；需要随 App 分发运行时（用 `bun build --compile` 打成单个可执行文件解决） |

> 说明：此前讨论中建议过「把 TS 引擎全部移植到 Rust」（方案 A）。核查代码后，改为推荐方案 C。原因是这个项目最怕「Agent 算出的 IPA / 音变与 GUI 不一致」，复用同一份代码是唯一能长期保证一致的办法。

### 3.2 推荐架构（方案 C）

```
┌────────────── Agent（DSH / Claude / Cursor）──────────────┐
│                       MCP over stdio                        │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────── conlang-mcp ─────────────────────────┐
│ mcp/server.ts    工具 / 资源 / Prompt 注册、配置、权限         │
│ mcp/tools/*      按模块划分的工具实现                          │
│ mcp/storage/     基于 fs 的存储（与 Rust 语义一致）+ 锁 + 版本号 │
│ mcp/font/        HarfBuzz wasm：cmap、glyph 名、GSUB、排版      │
└───────────────┬───────────────────────────────┬──────────────┘
                │ import                        │ 读写
┌───────────────▼─────────────┐   ┌─────────────▼──────────────┐
│ src/core/（新，纯 TS）        │   │ 项目目录（JSON / NDJSON /   │
│ 引擎：ipa / sca / morphology  │   │ 字体 / .oplog）             │
│ 流程：pullSync / autoGloss /  │   └─────────────▲──────────────┘
│ wordNormalize / ids          │                 │ 读写 + 文件监听
│ 数据：ipa_features / presets  │   ┌─────────────┴──────────────┐
└───────────────▲─────────────┘   │ Conlang Maker GUI（Tauri）   │
                │ import          │ Rust 存储 + React 前端        │
                └─────────────────┴────────────────────────────┘
```

### 3.3 代码组织要求

| 目录 | 内容 | 约束 |
| --- | --- | --- |
| `src/core/` | 从 `src/utils` 迁入的纯引擎；从组件中抽出的流程（Pull Sync 差异计算、自动标注、词条规范化与校验、ID / 时间戳生成） | **禁止** import `react`、`@tauri-apps/*`、DOM API；用 lint 规则加一个无 DOM 环境的导入测试来保证 |
| `src/utils/*` | 保留原路径作为再导出，GUI 代码无需大改 | — |
| `mcp/` | 服务本体 | 只依赖 `src/core`、`src/types` 和 MCP SDK |
| `src/types/index.ts` | 共享类型 | MCP 工具的输入输出 schema 由类型派生（zod） |

### 3.4 技术选型

| 项 | 选型 |
| --- | --- |
| 协议 SDK | `@modelcontextprotocol/sdk`（TS），stdio 传输；可选 Streamable HTTP（P2，仅本机） |
| 运行时 | Bun（项目已在用）；发布时用 `bun build --compile` 生成单个可执行文件 |
| 参数校验 | zod，自动生成 JSON Schema |
| 字体 | `harfbuzzjs`（wasm）：collectUnicodes、glyph 名、GSUB / GPOS 特性列表、shape |
| 锁 | 项目级目录锁 `<project>/.conlang-maker/lock/`。每次尝试独占创建含本机身份、PID 与新 nonce 的 owner 文件，核验唯一 owner 后进入。仅按已确证死亡的精确身份回收。完整协议与竞争验收见执行计划 §3.2 |

---

## 4. 接口通用约定

### 4.1 寻址

| 参数 | 规则 |
| --- | --- |
| `family` | 可选。可以是 `family_id`（注册路径的稳定短哈希，由 `family_list` 返回）、`.conlang` 绝对路径，或者在不歧义时用名称。省略时使用注册表里的 `active_family_index`。名称有歧义时返回 `AMBIGUOUS` 并列出候选 |
| `language` | 必填（语言级工具）。可以是 `language_id`、名称或目录路径；会做唯一性校验 |
| 词条 | 用 `(language, entry_id)` 定位。**`entry_id` 只在单门语言内唯一**，父子语言会共用同一个 ID |
| 映射表 | `map_id`；省略时用 `is_default: true` 的那张表 |

### 4.2 版本、并发与重试

- 每个可读的数据单元返回本地 `revision`（原始字节 SHA-256 前 16 位）。不存在的目标使用明确哨兵 `missing`，创建时同样校验。
- 普通更新与删除必须提供 `expected_revision`。跨多个数据单元的操作提供 `expected_revisions`。缺失返回 `REVISION_REQUIRED`，不一致返回 `CONFLICT`，附当前版本和变更摘要。GUI 与 MCP 使用同一约定。
- 基于音系、父语言、语言树等依赖计算的结果同时返回 `dependencies`。由预演提交的写入携带全部 `base_revisions`，写入时一并核验。
- `force: true` 记录显式覆盖意图。调用方仍须提供用户确认覆盖时的当前磁盘版本。确认后再次发生修改时继续返回 `CONFLICT`。
- 所有实际业务数据写入必须携带客户端预先生成的 `operation_id`。相同 ID、相同请求重试返回已保存的提交结果。相同 ID 携带不同请求返回 `VALIDATION`。GUI 保存重试复用原 ID，新内容使用新 ID。
- 写入返回 `{ operation_id, committed, changed, revision?, revisions?, snapshot_id?, summary, warnings? }`。事务记录保留提交结果，提交成功后响应或审计日志投影失败也能判定真实提交状态。清理前像后继续保留去重凭据，明确保留期和过期响应。
- 继承读取另返回 `effective_revision` 与依赖版本。本地文件 CAS 使用 `revision`。依赖版本用于预演校验、有效视图缓存及刷新。

### 4.3 预演

所有批量或破坏性写入都支持 `dry_run: true`。返回将发生的变化（新增 / 修改 / 删除计数和逐项差异摘要）、受影响范围以及 `base_revisions`。预演使用一致读取快照，不修改业务数据。实际提交须携带该预演依据的版本，依赖变化时重新预演。

### 4.4 分页与输出控制

- 列表类参数：`limit`（默认 50，最大 500）、`cursor`；返回 `next_cursor`、`total`。
- `fields`：字段裁剪（例如 `["entry_id","con_word_romanized","senses.gloss"]`）。
- `format`：`summary | full`。
- 超出体量上限时返回 `truncated: true` 和提示，不静默截断。

### 4.5 错误模型

工具错误统一用结构化内容返回（MCP `isError: true`）：

```json
{ "code": "CONFLICT", "message": "...", "hint": "先调用 phono_get 获取最新 revision", "details": {} }
```

| code | 含义 |
| --- | --- |
| `NOT_FOUND` | 语系、语言、词条、映射表等不存在 |
| `AMBIGUOUS` | 名称匹配到多个对象 |
| `VALIDATION` | 参数或数据校验失败（逐项列出原因）。例如词条缺释义时**直接报错**，不像 GUI 那样静默丢弃 |
| `CONFLICT` | 目标或依赖版本不一致，或恢复目标存在冲突 |
| `REVISION_REQUIRED` | 实际写入缺少目标或依赖版本 |
| `RECOVERY_REQUIRED` | 存在未完成事务且当前模式无法恢复，或自动恢复遇到需要处理的数据冲突 |
| `LOCKED` | 锁等待超时（默认 5 秒） |
| `READ_ONLY` / `DESTRUCTIVE_DISABLED` | 当前配置不允许这类写入 |
| `NO_FONT` | 语言及其祖先都没有字体 |
| `IO` | 文件系统错误 |

### 4.6 数据保真

- Rust、TS 与 GUI 的常规读写都**保留真正未知的字段**，覆盖顶层、嵌套对象和有稳定 ID 的数组元素。Rust 持久化模型增加扩展字段承载，GUI 更新时保留未编辑对象的扩展字段。显式删除对象或字段按工具语义执行。
- 一致性夹具先保存含未知字段的原始输入，再验证读写往返。golden 生成以 Rust 保真改造通过为前提，且逐项断言合成未知字段仍存在。
- 字形标注分别提供 `local_config`、`effective_config` 与 `annotations_source`。本地配置含本语言实际拥有或由本地旧字段迁移而来的标注。有效配置可合入祖先标注。普通配置保存只写本地内容。显式同步父标注和显式编辑标注分别定义为本地化操作。
- **已知废弃字段：先存档，再清理**（GUI 和 MCP 行为一致）。这些字段是已删除的自研拼字引擎留下的，现在已不参与显示和计算：
  - 顶层：`writing_systems`、`font_encoding_profiles`
  - 映射表：`writing_system_id`
  - 规则：`output_phonemes`、`phonemes_confirmed`、`writing_override`、`writing_overrides`

  第一次写入含有这些字段的 `phonology.json` 时，在事务内先把它们完整存档到 `<语言目录>/.conlang-maker/legacy/writing-<时间戳>-<operation_id>.json`，再写入本语言迁移所得的 `glyph_annotations` 并移除这些字段。存档同时列出需要人工确认的项目：`phonemes_confirmed=false` 的规则，例如 `i_peninsula` 的 `ch → tʃ`。
  - 现状：Terrax 工作区有 6 个文件含这些字段，已于 2026-11-11 手工备份到 `<工作区>/.conlang-maker/backup/legacy-writing-20261111/`。
- 规范化规则与 Rust 一致：默认值、`pos → pos_id` 别名、旧版 writing 迁移。祖先字形标注仅进入有效视图，并标注 `inherited_from`。其缓存依赖本地文件、实际祖先源文件及工作区拓扑版本。
- 各端写回前基于最新本地原文保留未知字段，并校验读取版本。数组对象按稳定 ID 合并。保存词典单个词条时，同桶其他词条的未知字段也须保留。
- 词典写入遵循现有布局：按首字母分桶、按 `con_word_romanized` 排序、换桶时去重（与 [lexicon.rs](../../src-tauri/src/commands/lexicon.rs) 一致）。

---

## 5. 工具目录

命名：`<领域>_<动作>`。工具按**工具集**分组，可以通过配置开关（§10）。默认启用 `core`、`audit`、`compute`，写入类默认关闭。

### 5.1 系统与语系（工具集 `core` / `admin`）

| 工具 | 优先级 | 读/写 | 说明 |
| --- | --- | --- | --- |
| `server_info` | P0 | 读 | 服务版本、启用的工具集、写入模式、默认语系、是否检测到 GUI 正在运行 |
| `family_list` | P0 | 读 | 附 registry_revision，列出注册表中的语系，`family_id`、名称、路径、最后打开时间、是否激活、语言目录是否完整（`validate_conlang_file`） |
| `family_get_tree` | P0 | 读 | 附 workspace revision，返回语言树，id / 名称 / 路径 / 父 / 子 / 深度、词条数、目录时间戳、**是否有自有字体、生效字体来自哪门语言** |
| `language_fork` | P1 | 写 | 派生子语言（语义与 `fork_language` 一致：复制音系、语法、词典、语料，SCA 置空，词条标为 `evolved`） |
| `language_update` | P1 | 写 | 改名；修改父语言（做环检测，并提示会影响字体和标注的继承） |
| `language_delete` | P2 | 破坏 | 删除语言（有子语言时拒绝）。通过项目事务把整个目录移入回收站并更新 `.conlang`，返回 `trash_id` |
| `language_trash_list` | P1 | 读 | 项目回收站条目及原 language_id / parent_id / path |
| `language_restore` | P2 | 破坏 | 按 `trash_id` 恢复语言目录与工作区条目。检查父语言存在、ID/path 冲突及项目 revision，支持 dry_run |
| `family_register` / `family_unregister` / `family_set_active` | P2 | 写 | 注册表管理 |
| `project_create` / `project_copy` | P2 | 写 | 新建项目 / 复制项目 |
| `lexicon_migrate_inherited_links` | P2 | 写 | 对应现有迁移命令，支持 dry_run |

### 5.2 音系与罗马音映射（`core` / `compute` / `write`）

| 工具 | 优先级 | 读/写 | 说明 |
| --- | --- | --- | --- |
| `phono_get` | P0 | 读 | 按 sections 返回 inventory、romanization、phonotactics、tones、allophony、glyph_annotations，分别提供 local_config 与 effective_config，附本地/有效版本及标注来源 |
| `romanization_get` | P0 | 读 | **专为映射场景设计**：返回全部或指定映射表，每条规则附派生信息：`chars`（NFC 分解出的字符和码位）、`nfd`、`is_multichar`、`has_context`、`output_in_inventory`；另有汇总：输入字符全集、多字符输入、条件规则数量 |
| `romanization_analyze` | P0 | 读 | 映射体检：①音素表中没有任何规则产出的音位；②产出了音素表之外音位的规则；③同输入、同上下文却产出不同的冲突规则；④完全重复的规则；⑤被更长输入或更特定上下文遮蔽、实际不会生效的规则；⑥大小写问题 |
| `phono_to_ipa` | P0 | 读 | 文本（单条或批量，≤500）→ 音位式 `/…/` 和表层式 `[…]`，可选 `trace`：逐段列出命中的规则 ID、**未匹配的字符**、应用的音位变体规则及每步输入/输出。罗马音区间对应原文，音位变体命中区间对应该步骤输入的码点，详见 T1.7 |
| `phono_tokenize` | P1 | 读 | 按音素表切分 IPA 串 |
| `phono_update` | P1 | 写 | 按 section 更新（整段替换或 JSON Merge Patch），带 expected_revision |
| `romanization_upsert_rules` | P1 | 写 | 在指定映射表中批量新增或修改规则（按 `rule_id`，缺省时自动生成），可指定插入位置；可选 `regenerate_ipa`，联动 `lex_regenerate_ipa` 进行 dry_run |
| `romanization_delete_rules` | P1 | 写 | 批量删除规则 |
| `romanization_map_upsert` | P1 | 写 | 新建 / 改名 / 设为默认 / 删除映射表 |
| `phono_presets_list` / `phono_apply_preset` | P2 | 读/写 | 内置音系预设（[phonology_presets.ts](../../src/data/phonology_presets.ts)） |

### 5.3 文字与字体（`core` / `audit` / `write`）

| 工具 | 优先级 | 读/写 | 说明 |
| --- | --- | --- | --- |
| `font_list` | P0 | 读 | 整个语系中每门语言的字体状态：自有 / 继承 / 无，来源语言，文件名，字体文件哈希（用于识别「多门语言其实共用同一份字体」） |
| `font_inspect` | P0 | 读 | 生效字体详情：来源语言、是否继承、家族名、版本、glyph 数、cmap 码位（压缩成区间，可分页展开）、按 Unicode 区块统计、**GSUB / GPOS 特性标签列表**（`ccmp`、`calt`、`ss01` 等）、解析警告 |
| `font_shape` | P0 | 读 | 用生效字体排版给定文本（特性默认与 GUI `.conlang-script` 一致，可覆盖，例如开启 `ss01`）→ glyph 序列（gid、glyph 名、cluster、来源字符）、是否出现 `.notdef`。用于调试 `.fea` |
| **`font_audit_coverage`** | **P0** | 读 | **单语言覆盖审计**，见 §6 |
| **`font_audit_family`** | **P0** | 读 | **全语系或子树覆盖矩阵**，见 §6.5 |
| `font_import` | P1 | 写 | 从本机绝对路径导入字体到指定语言（校验：大小 ≤20MB、`OTTO` / TrueType 魔数、HarfBuzz 能加载、cmap 非空）；会覆盖旧字体，先做快照 |
| `font_import_batch` | P1 | 写 | 批量导入，例如 `{ "l_lake": ".../TerraxLamiticLakePreview-Regular.otf", ... }`，一次给 8 个分支换上新编译的字体；整体 dry_run 时列出每门语言「旧字体 → 新字体」以及审计结果变化 |
| `font_clear` | P1 | 写 | 移除语言的自有字体（回退到继承），先做快照 |
| `glyph_annotations_upsert` / `glyph_annotations_delete` | P1 | 写 | 编辑本地字符参考标注（codepoint、label、kind、phonemes），编辑继承项时明确本地化范围 |
| `glyph_annotations_sync_parent` | P2 | 写 | 从父语言补齐标注（与 GUI「从父语言同步」一致） |

### 5.4 词典（`core` / `compute` / `write` / `evolution`）

| 工具 | 优先级 | 读/写 | 说明 |
| --- | --- | --- | --- |
| `lex_search` | P0 | 读 | 文本检索（拼写 / 释义 / 定义 / 例句 / 标签，可选前缀 / 精确 / 包含 / 正则）；过滤词性、`origin_type`、标签、弃用、「与父语言有差异」；`mode: "ipa_fuzzy"` 时调用 `ipaFuzzySearch`（带阈值）；支持排序、分页、字段裁剪 |
| `lex_get` | P0 | 读 | 按 `entry_id` 列表或精确拼写取完整词条；可选 `with_parent`，附父语言对应词条和差异 |
| `lex_stats` | P0 | 读 | `computeStatistics`：词数、词性分布、音位频率等 |
| `lex_quality_check` | P0 | 读 | `runQualityCheck`，可以开关规则（缺词性、未映射拼写、空 IPA、音节结构不符、必填缺失、重复词） |
| `lex_upsert` | P1 | 写 | 批量（≤500）新增或修改：自动生成 `entry_id` / `sense_id` / 时间戳。`phonetic_override=false` 时**用当前默认映射自动生成 IPA**。逐项校验并返回结果，存在无效项时整体拒绝实际提交，支持 dry_run |
| `lex_delete` | P1 | 写 | 批量删除，先做快照 |
| `lex_regenerate_ipa` | P1 | 写 | 改了映射或音位变体后，重新计算所有非 override 词条的 IPA；dry_run 时返回变化列表 |
| `lex_parent_diff` | P1 | 读 | 与父语言比较：经过本语言 SCA 后，待新增 / 待更新 / 冲突的词条（逻辑从 `PullSync.tsx` 抽到 core） |
| `lex_pull_sync` | P1 | 写 | 执行 Pull Sync（与 GUI 语义一致，先做快照），可以只处理部分 `entry_id` |
| `lex_borrow` | P2 | 写 | 从其他语言借词（`origin_type: borrowed`，记录来源） |
| `lex_import_csv` | P2 | 写 | 先预览（`previewCSVImport`），再提交 |

### 5.5 造词（`compute`）

| 工具 | 优先级 | 说明 |
| --- | --- | --- |
| `wordgen_generate` | P1 | 按音系结构生成候选词（数量、音节数范围、结构覆盖、排除已有词、按类型学推导配置）。只读，入库走 `lex_upsert` |
| `wordgen_swadesh_gaps` | P2 | Swadesh-100 中词典尚未覆盖的释义 |

### 5.6 语法（`core` / `compute` / `write`）

| 工具 | 优先级 | 读/写 | 说明 |
| --- | --- | --- | --- |
| `gram_get` | P0 | 读 | 按 sections 返回：`typology`、`syntax`、`pos`、`inflection`（维度、规则、词缀槽、变位类、不规则覆盖）、`derivation`、`chapters` |
| `gram_inflect` | P0 | 读 | 词（拼写或 entry_id）+ 维度取值 → 词形（`applyInflectionTypologyAware`），附命中规则 |
| `gram_paradigm` | P0 | 读 | 生成词形表（`generateParadigm`） |
| `gram_derive` | P1 | 读 | 派生规则预览（`generateDerivedWords`），入库走 `lex_upsert` |
| `gram_analyze_typology` | P1 | 读 | 类型学分析（`analyzeTypology`） |
| `sandbox_translate` | P1 | 读 | 翻译沙盒（`processSandboxText`）：释义串 → 屈折 + 语序调整后的目标语言句子 |
| `gram_update` | P1 | 写 | 按 section 更新，带 expected_revision |

### 5.7 历时音变 SCA（`core` / `compute` / `write`）

| 工具 | 优先级 | 读/写 | 说明 |
| --- | --- | --- | --- |
| `sca_get` | P0 | 读 | 规则集与规则（含特征模式） |
| `sca_simulate` | P0 | 读 | 对词表（或「某门语言的整个词典」）应用规则；可以传入**未保存的临时规则集**来试验；返回结果和逐步 changelog |
| `sca_parse_rules_text` | P1 | 读 | 解析文本格式规则（`parseSCARulesText`），返回结构化规则和逐行错误 |
| `sca_feature_query` | P1 | 读 | 特征表达式 → 匹配的音位 |
| `sca_update` | P1 | 写 | 新增 / 修改 / 排序 / 删除规则集和规则；也可以直接用文本格式提交 |
| `sca_export_rules_text` | P2 | 读 | 规则集序列化为文本格式 |

### 5.8 语料（`core` / `write`）

| 工具 | 优先级 | 读/写 | 说明 |
| --- | --- | --- | --- |
| `corpus_list` | P0 | 读 | 语料索引 |
| `corpus_get` | P0 | 读 | 语料全文与逐行逐词标注（按行分页） |
| `corpus_save` | P1 | 写 | 新增或修改语料（同步更新索引），带 expected_revision |
| `corpus_delete` | P2 | 破坏 | 删除语料，先做快照 |
| `corpus_auto_gloss` | P2 | 读/写 | 自动标注（需要先从 `GlossingEditor.tsx` 抽到 core），默认只预览 |

### 5.9 导入导出（`admin`）

| 工具 | 优先级 | 说明 |
| --- | --- | --- |
| `export_llm_brief` | P1 | 生成语言简报 Markdown（`generateLLMPrompt`），可选章节；也作为资源提供 |
| `export_workspace_bundle` | P1 | 导出工作区包到指定路径（含字体） |
| `export_csv` / `export_dic` | P2 | 词典 CSV；Hunspell `.dic` / `.aff` |
| `import_workspace_bundle` | P2 | 破坏性；先整体快照 |

### 5.10 快照（`core` / `write` / `admin`）

| 工具 | 优先级 | 说明 |
| --- | --- | --- |
| `snapshot_list` | P0 | 语言级或项目级快照，返回 ID、时间、类型、描述、范围、来源、level 与 restored_from。项目级查询仅需 family |
| `snapshot_create` | P1 | 手动创建语言级或项目级快照，明确目标及范围。项目快照包括工作区拓扑与目录存在状态 |
| `snapshot_rollback` | P2 | 破坏性，需要 `confirm: true`。作为新事务记录恢复动作，先保护当前状态，保留其他快照。项目快照按项目 ID 寻址 |
| `snapshot_diff` | P2 | 快照与当前数据的差异摘要 |

工具目录按独立工具名统计共 76 项，其中 P0 为 24 项、P1 为 30 项、P2 为 22 项。实际暴露数量按已交付里程碑、toolsets 和权限模式过滤。

---

## 6. 字体覆盖审计（详细设计）

### 6.1 目标

对一门语言，回答三个问题：
1. **会不会缺字**：需要用到的字符，生效字体的 cmap 里有没有？
2. **会不会没转写**：字符都在，但多字符输入或整词经过真实 OpenType 排版后，有没有残留「未转换」的字形？
3. **问题出在哪**：每个缺口都能追溯到具体的映射规则、词条或语料行。

### 6.2 输入参数（`font_audit_coverage`）

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `language` | — | 必填 |
| `sources` | `["romanization","lexicon","corpus","tones"]` | 需求来源 |
| `map_scope` | `"default"` | `default` / `all` / 指定 `map_id` |
| `shaping` | `true` | 是否做排版级检查 |
| `features` | 与 GUI 一致 | 从共享 `GUI_DEFAULT_LAYOUT` 读取，可以覆盖（如 `ss01`） |
| `normalization` | `as_used` | `as_used` / `NFC` / `NFD`，报告原文及实际送入字体的文本 |
| `direction` / `script` / `language_tag` | 与 GUI 默认布局一致 | 当前 GUI 基线为 LTR、HTML 语言 en。script 按输入 Unicode 运行确定。覆盖值写入报告 |
| `residual_glyph_pattern` | 无 | glyph 名正则，命中表示「输入没有被转换」，例如 Lamitic 用 `^roman\.`。可以在项目配置里按语言持久化（§10） |
| `case` | `"as_used"` | `as_used`（只检查实际出现的大小写）/ `both` |
| `max_examples` | 5 | 每个问题附带的示例数量 |

### 6.3 算法

1. **解析字体**：沿 parent_id 找第一份字体（与 `font.rs` 一致）。没有就返回 `NO_FONT`，并列出祖先链。
2. **加载字体**：HarfBuzz 读取 cmap 集合、glyph 名（post / CFF）和 GSUB 特性。
3. **提取需求**：
   - romanization：按所选规范化方式处理范围内每条规则的 `input`，固定按 Unicode 码点遍历，记录原文、送入字体的文本及 `(map_id, rule_id, output_phoneme)`。`Intl.Segmenter` 可用于原文区间展示，cmap 检查仍展开全部码点。上下文字段中的宏（`V`、`C`）和边界 `#` 不算字符需求。
   - lexicon：未弃用词条的 `con_word_romanized`。
   - corpus：语料原文行。
   - tones：声调 `marker`。
4. **字符级分类**（忽略空白，标点单独归类）：

   | 状态 | 判定 |
   | --- | --- |
   | `covered` | 码位在 cmap 中 |
   | `missing` | 码位不在 cmap 中，NFD 分解后也不全在 |
   | `decomposed_only` | 预组合字符（如 `ā`）不在，但 NFD 分解（`a` + U+0304）全在。是否显示正常取决于文本的规范化形式，作为**警告**处理 |
   | `case_missing` | 只有某一种大小写缺失，并且该大小写形式确实被用到 |

5. **排版级检查**（`shaping=true`）：
   - 对每个多字符输入，在相同方向、script、language、特性与规范化条件下比较整体及逐字符排版。字形替换比较 gid 序列，位置调整另比较 advance / offset。cluster 索引先映射到同一原文基准。结果标注 `substituted`、`positioning_only` 或 `sequence_not_unified`，均为行为说明。带上下文规则还从实际词例构造上下文样本，孤立排版结果附 `standalone_only`。多个输出字形本身不构成错误。
   - 对每个词条和语料行：排版后出现 gid 0（`.notdef`）记为 `notdef`。glyph 名命中 `residual_glyph_pattern` 记为 `residual`。字体缺少 glyph 名时，将该项标记为 `not_evaluated` 并报告原因。
   - shape 结果保留原始 cluster 值及其索引单位，并提供映射后的原文码点区间。一个 cluster 可覆盖多个字符或多个输出字形。报告列出 `checks_performed`、未执行检查与实际布局参数。
6. **未映射拼写**：用 `romanizationToPhonemes` 的 trace 找出词典中**没有任何映射规则能匹配**的字符或片段（独立于字体）。

### 6.4 输出结构（示意，数值与缺口随实际输入变化）

```json
{
  "language": { "id": "lang_mov0tedy", "name": "lamitic-alpha" },
  "font": { "owner": "lamitic-alpha", "inherited": false, "file": "font.otf",
            "family": "Terrax Lamitic Common Preview", "version": "0.190",
            "features": ["ccmp", "calt"], "engine": "harfbuzz 10.x (GUI 使用 WebKit/CoreText)" },
  "summary": { "required_chars": 31, "missing": 3, "decomposed_only": 0,
               "words_with_notdef": 214, "words_with_residual": 0, "unmapped_spellings": 0 },
  "missing_chars": [
    { "char": "c", "codepoint": "U+0063",
      "romanization": [ { "map_id": "f38c18db…", "rule_id": "…", "input": "c", "output": "…" },
                        { "map_id": "f38c18db…", "rule_id": "…", "input": "ch", "output": "…" } ],
      "lexicon": { "count": 120, "examples": [ { "entry_id": "…", "spelling": "…" } ] },
      "corpus": { "count": 8, "examples": [] } },
    { "char": "x", "codepoint": "U+0078", "...": "..." },
    { "char": "j", "codepoint": "U+006A", "...": "..." }
  ],
  "layout": { "normalization": "as_used", "direction": "ltr", "language_tag": "en",
              "script_source": "unicode_runs", "features_source": "GUI_DEFAULT_LAYOUT" },
  "checks_performed": ["cmap", "notdef", "substitution", "positioning"],
  "checks_not_evaluated": [{ "check": "residual", "reason": "residual_glyph_pattern 未配置" }],
  "dependencies": { "phonology.json": "<revision>", "workspace": "<revision>", "font.otf": "<revision>" },
  "sequence_issues": [],
  "words_with_notdef": { "count": 214, "examples": [], "next_cursor": "…" },
  "hints": [ "字体构建脚本 prepare.py 将 c/ch/x/j 列为 unresolved_dictionary_spellings（如能定位外部字体工程）" ]
}
```

（`family`、`version`、`summary` 和 `count` 都是示意值，以实测为准。）

> 2026-11-11 规划时的状态记录，后续以实际检查为准：Terrax 工作区里只有 `lamitic_alpha`、`l_east`、`l_lake`、`l_plateau` 有自有字体。`l_r1966`、`l_north`、`l_west`、`l_island` 都继承 `lamitic_alpha` 的字体，也就是说它们显示的并不是各自的地区版本。`font_list` / `font_audit_family` 需要把这种情况直接标出来，`font_import_batch` 负责一次性修正。

### 6.5 语系矩阵（`font_audit_family`）

- 参数含可选子树 root 与单语言审计参数。先取得同一项目视图，再逐语言计算。
- 输出：
  - `matrix[]`：每门语言一行，包括生效字体（及来源）、各类缺口计数、缺失字符列表；
  - `by_font[]`：按字体文件哈希复用分析结果，同时保留各个实际 owner 和文件路径。报告需更新的自有副本，继承者关联其 owner。
  - `union_missing`：全语系缺失字符的并集，以及每个字符涉及哪些语言。
- 性能：18 门语言、每门 5,000 词，开启排版检查时 < 20 秒；超时返回已完成的部分，并标记 `partial: true`。

### 6.6 外部字体工程关联（P2）

在项目配置里可以给语言关联外部字体工程目录（例如 `Lamitic_八版本字体_v019` + 版本名 `common`）。关联后，审计会额外读取该工程的 `encoding.json` / `manifest.json`，列出「工程已声明但未实现」的项目（例如 `unresolved_dictionary_spellings`），并在报告中给出对应 `.fea` 文件的路径。MCP **不修改**外部工程。

---

## 7. 并发与写入安全

以下项目事务约定覆盖工作区业务数据。注册表使用注册表级锁、revision 与恢复记录。新建/复制项目通过目标父目录协调锁与暂存目录提交，工具分别报告项目和注册表状态。导出文件先预演输出目标版本，再原子替换，遵守输出路径的版本与覆盖约定。具体任务见 T4.5–T4.6。

### 7.1 写入流水线（GUI 与 MCP）

1. 检查权限、参数、operation_id 与所需版本。锁外缓存仅作查询提示，最终幂等判定在锁内执行。
2. 获取项目锁。在写入模式下先恢复未完成事务。只读模式发现待恢复事务返回 `RECOVERY_REQUIRED`。
3. 锁内恢复完成后先按 operation_id 和请求摘要查提交凭据。相同请求返回原结果，同 ID 不同请求返回 VALIDATION。新请求再读取目标与依赖，核验全部 expected revision，计算变更与差异，预演在此返回。
4. 按策略创建语言级或项目级快照，保留当前状态的原始字节。
5. 在 `<project>/.conlang-maker/transactions/<operation_id>/` 准备事务清单、新内容及恢复前像。清单记录目标相对路径、写入前是否存在、前后哈希、文件替换及目录创建/移动操作。前像和清单可靠写入后才开始应用。
6. 文件使用同目录唯一临时文件、fsync、rename。多文件和目录动作属于同一个事务。全部成功后先持久化业务文件和结果、审计事件，完成受影响目录的必要同步，再持久化 committed 标记并同步事务目录。目标平台须验证该顺序及其进程终止、系统崩溃恢复边界。
7. 提交事件按 `operation_id` 幂等投影到审计日志。投影失败保留待补写信息，返回真实提交结果及警告。下次启动补写。
8. 释放锁，返回提交状态、结果版本及快照 ID。

准备后尚未提交的操作在异常或下次取得锁时按前像补偿，恢复动作可重复执行。已提交操作补齐日志和清理，不重新应用业务变更。恢复冲突或失败保留事务材料并返回 `RECOVERY_REQUIRED`。

### 7.2 Rust 与 TS 侧共同要求

- 目录锁使用执行计划 §3.2 的同一协议。owner 文件名含可独立识别的本机身份、PID 与每次新 nonce，内容损坏时仍可判定对应进程是否死亡。
- 回收仅删除已确证死亡的那个 owner 文件。释放仅删除本次成功独占创建的 owner 文件。之后尝试删除空目录，不递归删除锁目录。新尝试发布 owner 后必须完整核验唯一 owner。
- 进程内按项目互斥。重入绑定同一执行上下文，其他并行任务正常排队。Windows 与 Unix 都以进程确证死亡为自动回收条件，权限不足、身份不同或检测未知时等待并报告。
- 项目写入、快照、恢复和一致读取使用同一个锁入口。业务命令嵌套调用复用外层事务和执行上下文。
- GUI 保存也必须携带读取时的本地 revision，M2 首次开放 MCP 写入时完成所有保存入口改造。

### 7.3 快照策略与扩展

| 项目 | 约定 |
| --- | --- |
| 语言级快照 | 保留 `<lang>/.oplog/` 布局。manifest 声明 lexicon / phonology / grammar / sca / corpus / font，旧快照按 lexicon 处理 |
| 项目级快照 | 存于 `<project>/.conlang-maker/snapshots/`。包含 `.conlang`、受影响语言的原始条目和目录存在状态，以及恢复所需文件或目录前像 |
| 自动选择 | 改父语言、派生、删除/恢复语言、整包导入及跨语言批量操作使用项目级恢复范围。单语言操作使用相应语言范围 |
| 自动创建 | 批量写入（≥20 项）、删除、字体导入、Pull Sync、整包导入、改父语言必须快照。单条小改每会话每语言每文件首次写入快照。预演报告恢复范围 |
| 回滚 | 在项目事务内先保护当前状态，再恢复目标 scope，记录 `restored_from`。保留原快照及其他范围恢复点 |
| 目录存在状态 | 原本不存在的文件、字体或语言目录恢复为不存在。目录冲突按显式恢复规则处理 |
| 回收站 | 删除语言保存完整目录、原 LanguageEntry 与项目恢复点。`language_restore(trash_id)` 恢复原 parent/path，并检查冲突 |
| 目录移除后的历史 | 项目恢复移除语言目录前，在同一事务内转存该语言的 .oplog 至项目 snapshots 的 archived_languages 区，保存原 LanguageEntry 和移除前目录恢复基线。按 family + language_id + snapshot_id 查询，语言不存在时仍可访问 |
| 已移除语言的恢复 | archived language 快照回滚先预演重建目录与原条目，再以移除前基线补齐目录并恢复目标 scope。整体使用项目事务，检查父语言、ID/path 及当前项目 revision |
| 保留策略 | max_snapshots 管理已完成历史，活动事务、待恢复材料、转存历史所依赖的目录基线与正在恢复的快照受保护 |

### 7.4 权限模式

| 模式 | 允许 |
| --- | --- |
| `read-only`（默认） | 读取与计算，可使用协调锁。发现未完成事务时返回恢复状态 |
| `write` | 加上普通写入及事务恢复 |
| `write+destructive` | 加上删除、回滚、整包导入及回收站恢复。破坏性工具还需要 `confirm: true` |

### 7.5 一致读取与依赖失效

- 查询先在项目锁内检查事务状态并采集完整输入及版本，再释放锁执行 IPA、SCA、HarfBuzz 等计算。语系审计采集同一个项目视图。
- 有效音系与字体结果依赖本地文件、实际祖先文件、工作区父链以及所用布局配置。缓存键与失效逻辑包含这些依赖，响应返回相应版本。
- 同哈希字体可以共享解析缓存，归属与更新目标仍按实际文件区分。
- GUI 的提交事件和文件监听触发重新核对版本。监听延迟或漏事件由保存 CAS 兜底。

---

## 8. GUI 侧配套改造

| 编号 | 需求 | 优先级 | 说明 |
| --- | --- | --- | --- |
| UI-1 | 监听外部变更 | P0（M2） | Rust 用 notify 监听业务文件及事务提交。去抖后核对提交和版本信息，发出含 operation_id / origin / revisions 的变更事件 |
| UI-2 | 自动刷新 | P0（M2） | 对应 store 无待保存或在途修改时重新加载。父链、祖先标注和字体归属变化同时使相关有效视图失效 |
| UI-3 | 冲突提示 | P0（M2） | dirty、排队或在途保存遇到版本冲突时暂停该上下文的自动保存，提供保留本地 / 采用磁盘 / 查看差异。保留本地以刚确认的磁盘版本再次 CAS |
| UI-4 | 带版本校验的保存 | P0（M2） | GUI 读取保存本地及依赖版本，所有实际保存提供 expected revision 和 operation_id。校验失败进入 UI-3 |
| UI-5 | 快照与恢复面板 | P1（M3） | 显示来源、范围、项目恢复点与回收站。支持非词典数据、拓扑和语言恢复 |
| UI-6 | MCP 设置页 | P1（M4） | 显示可执行文件路径；一键复制 DSH / Claude Desktop / Cursor 的配置片段；选择默认权限模式；查看最近的 MCP 审计日志 |
| UI-7 | 审计入口 | P2 | 字体页「覆盖检查」升级为与 `font_audit_coverage` 同一套逻辑（映射 + 词典 + 语料） |

---

## 9. 资源与 Prompts

### 9.1 资源（只读，URI 模板）

| URI | 内容 |
| --- | --- |
| `conlang://families` | 语系列表 |
| `conlang://{family_id}/tree` | 语言树 |
| `conlang://{family_id}/{language_id}/brief` | 语言简报 Markdown（LLM 友好，适合作为长期上下文） |
| `conlang://{family_id}/{language_id}/phonology` | 音系 JSON |
| `conlang://{family_id}/{language_id}/romanization` | 映射规则（含派生信息） |
| `conlang://{family_id}/{language_id}/grammar` | 语法 JSON |
| `conlang://{family_id}/{language_id}/sca` | SCA 规则 |
| `conlang://{family_id}/{language_id}/font` | 字体检查结果 |
| `conlang://{family_id}/{language_id}/lexicon/{entry_id}` | 单个词条 |
| `conlang://{family_id}/{language_id}/corpus/{corpus_id}` | 单篇语料 |

P2：资源订阅（基于文件监听推送 `resources/updated`）。
注意：部分客户端只支持工具，所以资源能做的事**都必须也能通过工具完成**。

### 9.2 Prompts

| 名称 | 参数 | 作用 |
| --- | --- | --- |
| `audit_font_coverage` | language / root | 引导 Agent：审计 → 解读 → 给出补字形或补 `.fea` 规则的建议清单 |
| `review_romanization` | language | 映射体检，加上与音素表、词典的交叉核对 |
| `design_sound_changes` | parent, child | 用 `sca_simulate` 迭代设计音变 |
| `lexicon_cleanup` | language | 质检 → 分批修复（dry_run → 确认 → 写入） |

---

## 10. 配置与分发

### 10.1 启动参数 / 环境变量

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--mode` | `read-only` | `read-only` / `write` / `write+destructive` |
| `--toolsets` | `core,audit,compute` | 可选：`core`、`audit`、`compute`、`write`、`evolution`、`admin`；`all` 表示全部 |
| `--family` | 注册表中激活的语系 | 默认语系 |
| `--registry` | 平台默认路径 | 注册表路径（测试用） |
| `--allow-root` | 注册表中全部项目目录 | 允许访问的目录白名单；`font_import` 的来源路径另外校验可读 |

项目级可选配置 `<project>/.conlang-maker/mcp.json`：按语言设置 `residual_glyph_pattern`、外部字体工程关联、自动快照阈值。

### 10.2 分发

- 用 `bun build --compile` 生成 `conlang-mcp`（macOS arm64 / x64，Windows，Linux），作为 Tauri `externalBin` 随 App 安装。
- 开发态：`bun run mcp`（直接运行源码）。
- DSH 配置示例：

```json
{ "mcpServers": { "conlang": {
    "command": "/Applications/conlang-maker.app/Contents/MacOS/conlang-mcp",
    "args": ["--mode", "write", "--toolsets", "core,audit,compute,write"] } } }
```

---

## 11. 非功能需求与测试

### 11.1 性能

| 场景 | 目标 |
| --- | --- |
| `family_get_tree`（18 门语言） | < 300ms |
| `lex_search`（5,000 词） | < 200ms |
| `font_audit_coverage`（5,000 词，含排版） | < 3s |
| `font_audit_family`（18 门语言） | < 20s，支持部分返回 |
| 冷启动 | < 500ms |

解析缓存以内容 revision 和实际依赖版本校验。mtime、size 仅用于减少读取，祖先源文件、父链或布局变化时重新解析。

### 11.2 可靠性

- 任何异常都不能留下写了一半的文件（原子写入）。
- 持有进程退出后，下一竞争者按确切 owner 身份回收锁。零字节 owner、发布中断、多个回收者与目录重建均有测试。
- 多文件操作中断后按事务清单恢复到提交前或已提交状态。读取、回滚和重试使用相同恢复入口。

### 11.3 隐私与安全

- 不联网，不收集遥测。
- 只访问白名单目录；拒绝 `..` 和越界的符号链接（与 `language_dir` 校验一致）。

### 11.4 测试策略

| 类型 | 内容 |
| --- | --- |
| 存储一致性（关键） | 原始合成夹具含顶层、嵌套及同桶其他词条的未知字段。覆盖 GUI / Rust / TS 双向保存、换桶、fork、语料索引及包导入导出，检查已知值与未知字段均保真 |
| 继承与缓存 | 子语言普通保存后继续继承。祖先标注变更、活动语言改父后，effective revision 与 GUI 字体立即更新 |
| 计算一致性 | 引擎迁入 `src/core` 后，GUI 与 MCP 跑同一组测试（沿用并扩展现有的 `bun test`） |
| 工具契约 | 每个工具的 schema 快照测试；错误码覆盖 |
| 审计验收 | 合成夹具精确断言预置缺口。Terrax 副本按独立采集的当前文件、cmap、父链和字体归属核对，不固定缺失字符或继承名单 |
| Unicode 与排版 | 分解字符、组合附标、补充平面码点、原文区间、大小写 fallback、布局参数、上下文样本与缺 glyph 名时的未评估状态 |
| 并发与恢复 | 同桶及跨桶双进程写入。监听延迟下的旧 GUI 保存。并发回收锁。各事务步骤故障注入与进程终止。重试、交错 scope 回滚、改父/导入/删除恢复均验证最终状态 |
| 端到端 | 用 MCP Inspector 和 DSH 实际连接，跑完 §9.2 的 4 个 Prompt 流程 |

---

## 12. 里程碑与验收

| 里程碑 | 交付 | 验收标准 |
| --- | --- | --- |
| **M0 基础改造** | src/core 抽取及 trace。Rust/GUI 未知字段保真。本地与有效视图区分。项目锁、Rust 事务与一致读取。旧字段存档。语言/项目快照与恢复。一致性测试框架 | GUI 行为无变化（现有测试全部通过 + 手工回归）。`src/core` 能在无 DOM 环境中导入 |
| **M1 只读 MVP + 审计** | 服务骨架、寻址、分页、错误模型；§5 中全部 P0 工具；资源（brief / phonology / romanization / font）；`audit_font_coverage` Prompt | Terrax 副本验收通过（§11.4）；DSH 能连上并完成「查 lamitic-alpha 字体缺口」 |
| **M2 安全写入** | TS 写入事务、恢复与审计。各数据域 P1 写入工具。GUI UI-1～UI-4 | GUI 与 MCP CAS、监听延迟及在途保存测试通过。多文件崩溃恢复、跨 scope 回滚及双向保真通过 |
| **M3 全面覆盖** | 派生 / 改父 / 删除与恢复语言 / Pull Sync / 语料 / 造词 / 沙盒 / 导出 / 其余 P1、P2 工具。其余 Prompts。UI-5 | §12.1 覆盖矩阵通过，项目导入和语言回收站恢复验收通过 |
| **M4 打包分发** | 多平台可执行文件、`externalBin`、UI-6 设置页、中英文档（`docs/zh|en/modules/mcp.md`） | 从安装包安装后，按设置页复制的配置即可直接使用 |

### 12.1 GUI 功能覆盖矩阵（验收清单）

| GUI 模块（路由） | 功能 | MCP 对应 |
| --- | --- | --- |
| 欢迎页 `/welcome` | 语系列表 / 打开 / 新建 / 复制 | `family_list`、`family_*`、`project_*` |
| 词典 `/lexicon` | 浏览、检索、IPA 模糊搜索、编辑、快速录入、质检、统计、父语言差异 | `lex_*`、`phono_to_ipa` |
| 音系 `/phonology/*` | 音素表、罗马音映射、音系结构、音位变体、预设 | `phono_*`、`romanization_*` |
| 文字 `/writing/*` | 字体导入 / 移除 / 继承、试写、缺字检查、字符表标注 | `font_*`、`glyph_annotations_*` |
| 语法 `/grammar/*` | 类型学、句法、词性、屈折体系、派生、参考章节 | `gram_*` |
| 翻译沙盒 `/sandbox` | 释义 → 目标语言句子 | `sandbox_translate` |
| 造词 `/wordgen` | 生成候选词 | `wordgen_*` |
| SCA `/sca` | 规则集编辑、文本导入、预览、批量应用 | `sca_*`、`lex_upsert` |
| 语系树 `/tree` | 树、派生、删除、Pull Sync、借词、迁移 | `family_get_tree`、`language_*`、`lex_parent_diff`、`lex_pull_sync`、`lex_borrow`、`lexicon_migrate_inherited_links` |
| 语料 `/corpus` | 语料与标注、自动标注 | `corpus_*` |
| 导入导出 `/export` | 工作区包、CSV、`.dic`、LLM 简报；~~PDF / Excel~~（范围外） | `export_*`、`import_workspace_bundle`、`lex_import_csv` |
| 快照与恢复 | 语言/项目快照、回滚、回收站列表与语言恢复 | `snapshot_*`、`language_trash_list`、`language_restore` |

---

## 13. 既有决策与本次审查修订（2026-11-11）

| # | 问题 | 建议 |
| --- | --- | --- |
| Q1 | 架构选方案 C（TS 独立服务 + 共享引擎）还是方案 A（Rust 重写）？ | **已定：C** |
| Q2 | 默认权限模式：`read-only`，还是在本机信任环境下默认 `write`？ | **已定**：默认 `read-only`，DSH 配置里显式改成 `write` |
| Q3 | GUI 有待保存修改时遇到外部变更：弹窗让用户选（UI-3），还是「外部优先」直接覆盖？ | **已定**：弹窗 |
| Q4 | `residual_glyph_pattern` 等审计配置存在项目目录（`.conlang-maker/mcp.json`，跟随项目和 iCloud 同步），还是只作为调用参数？ | **已定**：存项目目录 |
| Q5 | 外部字体工程关联（§6.6）是否纳入本期？ | **已定**：P2，放到 M3 之后 |
| Q6 | 旧版拼字引擎遗留字段怎么处理？ | **已定**：先存档再清理（§4.6），GUI 与 MCP 一致；真正的未知字段继续保留 |
| Q7 | 本期是否需要 Streamable HTTP 传输（给不支持 stdio 的客户端用）？ | **已定**：不需要，P2 |


Q1–Q7 沿用执行日志中已有的负责人确认记录。本版补充以下执行约束，并由相应任务验证。

| 编号 | 审查修订 | 验证任务 |
| --- | --- | --- |
| R1 | GUI 保存 CAS 前置到 M2，实际写入必须校验目标版本，预演提交同时校验依赖版本 | T3.1、T3.11、T3.10 |
| R2 | 目录锁采用独立 owner 身份与唯一 owner 核验，保守判断进程死亡，覆盖发布与回收竞争 | T1.9、T2.5、T3.10 |
| R3 | 多文件及拓扑操作采用项目事务，一致读取在锁内采集输入，崩溃后可恢复 | T1.15、T3.1、T3.10 |
| R4 | 项目级快照与回收站恢复覆盖 .conlang 和目录存在状态，回滚保留其他恢复点 | T1.11、T3.2、T4.1、T4.8 |
| R5 | Rust/GUI/TS 保留未知字段，本地与有效继承数据分别表示，缓存覆盖祖先与父链依赖 | T1.13、T1.14、T1.12、T3.9 |
| R6 | trace 与字体检查明确规范化和索引单位，MCP tsconfig 修正路径，真实验收根据当前事实生成预期 | T1.7、T2.2、T2.6、T2.9、T2.11 |
