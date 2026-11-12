# MCP 服务与 AI 协作

通过 Model Context Protocol (MCP) 将 AI 助手直接接入你的 Conlang Maker 语系工作区，一站式完成音系分析、词典编纂、历时音变推演与 OpenType 自造字字体覆盖审计。

**导航入口**：点击侧边栏或标题栏的 `MCP 设置`（`Settings -> MCP`），即可查看服务状态与地址、管理访问令牌、复制各客户端配置片段（含 stdio 后备），并浏览最近的 MCP 操作审计日志。

---

## 1. 功能概览 —— MCP 能带来什么

`conlang-mcp` 是 Conlang Maker 内置的本地 **Model Context Protocol (MCP)** 服务端。桌面端会以 **Streamable HTTP**（仅本机 `127.0.0.1`）托管它，各类 AI 客户端（**Cursor**、**Claude Code** 等）凭访问令牌接入；只支持 stdio 的客户端（如 **Claude Desktop**）仍可使用 stdio 后备模式。它把你的**工作区语言资产**与 Conlang Maker 的**语言学计算引擎**统一暴露为结构化语义工具、只读资源和引导工作流。

### 核心能力

- **两种运行方式**：桌面端的 HTTP 服务随应用启停；stdio 模式（`conlang-mcp` / `conlang-mcp --stdio`）可由客户端自行拉起，即使没有启动 GUI 也能直接读写磁盘上的工作区文件——检索词典、推演音变或执行整棵语系树的字体覆盖审计。
- **100% 共享核心计算引擎（`src/core`）**：与桌面 GUI 共用同一套 TypeScript 语言学引擎（IPA 转换与罗马音逐段追踪、音素切分、形态屈折与变位表生成、派生构词、语言类型学分析、Pull Sync 差异计算、语料莱比锡自动标注、SCA 历时音变推演），并内置 **HarfBuzz (WebAssembly)** 完成真实的 OpenType 排版（`GSUB`/`GPOS`）与字形覆盖审计。
- **语义级寻址**：AI 不再直接拼改底层 `.ndjson` 分桶或 JSON 文件，而是以“语系、谱系树、正字法映射表、跨代对齐词条（`entry_id`）、形态规则、分域快照”为单位安全操作。
- **与运行中的 GUI 安全共存**：你可以一边打开 Conlang Maker 编辑语言，一边让 AI 助手协作处理同一个项目：
  - **项目协调锁**：所有一致读取、写入、快照与恢复统一通过 `<project>/.conlang-maker/lock/` 目录下的 `owner-<host>-<pid>-<nonce>.json` 协调，跨进程互斥且能自动回收已崩溃本机进程的残留锁。
  - **版本校验（CAS）**：每个读取单元返回内容哈希版本 `revision`（SHA-256 前 16 位）与依赖版本 `dependencies`；所有修改必须携带 `expected_revision`（或 `expected_revisions`）与幂等请求标识 `operation_id`。
  - **多文件原子项目事务**：词典跨桶换位、语料正文与索引同步、批量字体替换、语系树派生/删除/恢复等全部纳入 `<project>/.conlang-maker/transactions/<operation_id>/` 预写日志事务，中途断电或异常退出也能自动前像回滚或补齐提交。
  - **实时外部变更监听**：当 `conlang-mcp` 提交修改后，打开的桌面端会自动捕获变更通知——若对应模块无未保存修改则静默刷新（含祖先字体与字形标注继承缓存）；若有未保存草稿则自动暂停自动保存，弹出**保留本地 / 采用磁盘 / 查看差异**冲突对话框。
- **可控输出与完全本地隐私**：列表工具内置分页（`limit` 默认 `50`、最大 `500`，支持 `cursor`）、点路径字段裁剪（`fields`）与摘要模式（`format: "summary" | "full"`），单次响应超过 100,000 字符时自动截断并标注 `truncated: true`。服务纯本地运行，**无任何网络请求或遥测上传**，并支持 `--allow-root` 目录白名单隔离。

---

## 2. 启动服务与客户端接入

### 2.1 服务由 GUI 托管

打开 Conlang Maker 桌面端后，`conlang-mcp` 会以 **Streamable HTTP** 模式自动启动，只监听本机回环地址：

```
http://127.0.0.1:43117/mcp
```

**MCP 设置** 页顶部的「服务状态」卡片显示当前状态（运行中 / 已停止 / 启动中 / 端口被占用 / 出错）、服务地址、版本、当前会话数与进程 PID，并提供：

| 操作 | 说明 |
| --- | --- |
| 启动 / 停止 / 重启 | 手动控制服务进程 |
| 端口 | 默认 `43117`，改成别的端口后自动重启服务 |
| 日志文件 | 启动失败时显示错误摘要与 `logs/mcp-server.log` 路径 |

服务随应用启动、随应用退出而停止；不做登录自启。如果 GUI 被强制结束，服务会通过父进程看门狗在数秒内自行退出。

:::tip
`curl http://127.0.0.1:43117/healthz` 会返回 `{ok, name, version, pid, port, started_at, sessions}`，可用于确认服务是否正常。
:::

### 2.2 访问令牌

HTTP 模式按 **令牌** 授权：每个 Agent 使用一个令牌，令牌各自携带权限模式、工具集与默认语系。

在「访问令牌」卡片中可以：

- **新建令牌**：填写名称，选择权限模式（沿用[第 3 节](#3-权限模式与安全边界)的三档说明）、工具集（按权限模式自动推导 / 全部 / 自定义多选）与默认语系（动态发现 / 当前打开的语系 / 从已注册语系中选择）。
- **复制令牌**：令牌默认打码显示，点击眼睛图标可查看明文，点击复制按钮写入剪贴板。
- **重新生成**：立即作废旧令牌，使用它的客户端会失效。
- **启用 / 停用**：停用后该令牌的请求立即返回 401。
- **删除**：从 `mcp-server.json` 中移除。

表格中的「最近使用」来自 `mcp-token-usage.json`（服务最多每 15 秒落盘一次）。

:::warning
权限模式或工具集改动后，该令牌已有的会话会在下一次请求时收到 404，客户端按 MCP 规范重新初始化即可拿到新权限。若某个客户端不会自动重连，手动重连一次即可。
:::

### 2.3 客户端配置

在令牌表格中选中一个令牌，页面下方的「客户端接入配置」会生成对应片段，可直接复制。

**Cursor**（`.cursor/mcp.json` 或 `~/.cursor/mcp.json`）：

```json
{
  "mcpServers": {
    "conlang-maker": {
      "url": "http://127.0.0.1:43117/mcp",
      "headers": { "Authorization": "Bearer <令牌>" }
    }
  }
}
```

**Claude Code**：

```bash
claude mcp add --transport http conlang-maker http://127.0.0.1:43117/mcp \
  --header "Authorization: Bearer <令牌>"
```

**其他 HTTP 客户端**：向 `http://127.0.0.1:43117/mcp` 发送请求，并带上

```
Authorization: Bearer <令牌>
Content-Type: application/json
Accept: application/json, text/event-stream
```

### 2.4 stdio 后备

只支持 stdio 的客户端（例如 Claude Desktop）仍可使用「stdio 后备配置」折叠面板中的片段：

```json
{
  "mcpServers": {
    "conlang-maker": {
      "command": "/Applications/Conlang Maker.app/Contents/MacOS/conlang-mcp",
      "args": ["--mode", "read-only", "--toolsets", "core,audit,compute"]
    }
  }
}
```

stdio 模式下可执行文件路径：

| 运行环境 | 可执行文件 / 启动命令 |
|---------|---------------------|
| **macOS** | `/Applications/Conlang Maker.app/Contents/MacOS/conlang-mcp` |
| **Windows** | `%LOCALAPPDATA%\Conlang Maker\conlang-mcp.exe` |
| **Linux** | `/usr/bin/conlang-mcp`（或安装包/AppImage 同级目录） |
| **源码开发模式** | `bun mcp/main.ts`（HTTP：`bun mcp/main.ts serve`） |

stdio 模式由客户端自行拉起进程，`--mode` / `--toolsets` / `--family` 直接生效，不经过 HTTP 令牌。

### 2.5 启动参数与环境变量

以下参数适用于 stdio 模式；在 `serve` 模式下 `--registry` / `--allow-root` 作为所有会话的基线配置，`mode` / `toolsets` / `family` 由每个令牌覆盖。所有命令行参数均支持对应的 `CONLANG_MCP_*` 环境变量（命令行参数优先级更高）：

| 命令行参数 | 环境变量 | 默认值 | 说明 |
|-----------|---------|-------|------|
| `--mode` | `CONLANG_MCP_MODE` | `read-only` | 权限模式：`read-only`、`write` 或 `write+destructive`。 |
| `--toolsets` | `CONLANG_MCP_TOOLSETS` | `core,audit,compute` | 启用的工具集（逗号分隔）：`core`、`audit`、`compute`、`write`、`evolution`、`admin` 或 `all`。 |
| `--family` | `CONLANG_MCP_FAMILY` | 注册表当前激活语系 | 调用工具省略 `family` 参数时默认使用的语系（`family_id`、`.conlang` 路径或无歧义名称）。 |
| `--registry` | `CONLANG_MCP_REGISTRY` | 系统应用数据目录下的 `registry.json` | 覆盖工作区注册表文件路径（便于隔离测试或多配置切换）。 |
| `--allow-root` | `CONLANG_MCP_ALLOW_ROOT` | 所有已注册工作区目录 | 允许访问的根目录白名单（禁止 `..` 路径逃逸与越界符号链接）。 |
| `--port` | — | `43117` | 仅 `serve`：HTTP 监听端口。 |
| `--settings` | `CONLANG_MCP_SETTINGS` | 应用数据目录下的 `mcp-server.json` | 仅 `serve`：设置文件路径。 |
| `--parent-pid` | — | — | 仅 `serve`：父进程消失后自动退出。 |

`conlang-mcp serve` 的退出码：`0` 正常退出、`3` 本端口已有 conlang-mcp 在运行、`4` 端口被其他程序占用、`1` 其他错误。

### 2.6 项目级配置文件（`.conlang-maker/mcp.json`）

你可以在工作区根目录下的 `.conlang-maker/mcp.json` 中保存随项目同步的审计规则与快照策略：

```json
{
  "autoSnapshot": "threshold",
  "residualGlyphPatterns": ["^roman\\."]
}
```

- **`autoSnapshot`**：自动快照策略（`"always"` 每次写入均快照、`"threshold"` 默认按阈值与会话首次写入快照、`"off"` 仅保留破坏性强制快照）。
- **`residualGlyphPatterns`**：`font_audit_coverage` 与 `font_audit_family` 默认用于检测“未被 GSUB 替换掉的残留拉丁占位字形”的正则列表（工具调用时也可单独覆盖 `residual_glyph_pattern`）。

### 2.7 安全说明

- 服务只绑定 `127.0.0.1`，并要求 `Host` 头为本机回环地址；带 `Origin` 的请求只接受 `http://127.0.0.1:<端口>`、`http://localhost:<端口>` 或 `http://[::1]:<端口>`，用来挡住 DNS rebinding 与浏览器跨站调用。
- 令牌以明文保存在仅本人可读写（`0600`）的 `mcp-server.json` 中，**不会出现在日志、审计记录或报错信息里**。泄露后请立即「重新生成」或删除该令牌。
- 请求体上限 4 MiB（超出返回 413）；会话空闲 60 分钟后自动关闭。
- 所有写入仍受第 3 节的权限模式、乐观锁（`expected_revision`）、项目事务与非破坏性快照保护。

---

## 3. 权限模式与安全边界

### 三档权限模式

权限模式可以按进程（stdio 的 `--mode`）或按令牌（HTTP 设置页中的令牌 `mode`）设置，默认都是 **`read-only`（只读）**，写入与破坏性能力必须显式开启：

| 模式 | 允许的操作 | 未完成事务处理 | 额外确认要求 |
|------|-----------|--------------|-------------|
| `read-only` *（默认）* | 全部读取、检索、字体检查、语言学计算、覆盖审计与 `dry_run` 预演；读取时同样获取协调锁保证视图一致。 | **绝不修改磁盘**；若检测到未完成事务则返回 `RECOVERY_REQUIRED`。 | — |
| `write` | 包含 `read-only` 全部能力，并开放常规写入（音系、正字法规则、字形标注、词典增改删/重算 IPA、语法、SCA、语料保存、字体导入/清除、派生语言、Pull Sync、手动快照、文件导出）。 | 进入项目锁后自动前像回滚或补齐中断事务。 | 必须携带 `expected_revision` 与 `operation_id`。 |
| `write+destructive` | 包含 `write` 全部能力，并开放破坏性或拓扑/历史恢复操作：`language_delete`、`language_restore`、`corpus_delete`、`import_workspace_bundle`、`snapshot_rollback`。 | 自动执行完整事务恢复。 | 调用参数中**必须额外显式传入 `"confirm": true`**。 |

:::warning 破坏性操作双重门禁
仅在启动参数设置 `--mode write+destructive`（HTTP 模式下则是把令牌的权限模式设为“完全权限”）并不会自动放行删除或回滚——每次调用破坏性工具时，参数里还必须显式带上 `"confirm": true`（建议先用 `"dry_run": true` 预览影响范围），否则服务会返回 `DESTRUCTIVE_DISABLED` 或 `VALIDATION`。
:::

### 工具集按需裁剪（`--toolsets` / 令牌 `toolsets`）

为了避免一次性向模型注入过多工具挤占上下文窗口，76 个工具按职责划分为 6 个工具集（写工具需同时满足工具集启用与 `--mode` 权限）：

| 工具集 | 默认启用 | 覆盖范围 |
|-------|---------|---------|
| `core` | 是 | 语系发现、谱系树、音系/正字法/词典/语法/SCA/语料/字体读取、快照与回收站列表。 |
| `audit` | 是 | 单语言与全语系 OpenType 字体覆盖矩阵审计（`font_audit_coverage`、`font_audit_family`）及 HarfBuzz 排版诊断（`font_shape`）。 |
| `compute` | 是 | 语言学计算与质检：`phono_to_ipa`（含逐段 trace）、`phono_tokenize`、`romanization_analyze`、`lex_stats`、`lex_quality_check`、`wordgen_*`、`gram_inflect`、`gram_paradigm`、`gram_derive`、`gram_analyze_typology`、`sandbox_translate`、`sca_simulate`、`sca_parse_rules_text`、`sca_feature_query`、`sca_export_rules_text`。 |
| `write` | 否 | 音系、正字法、字形标注、字体导入/批量替换、词典、语法、SCA、语料保存与手动快照创建。 |
| `evolution` | 否 | 历时演化工作流：`language_fork`、`language_update`、`lex_parent_diff`、`lex_pull_sync`、`lex_borrow`、`lexicon_migrate_inherited_links`。 |
| `admin` | 否 | 注册表与项目管理（`family_*`、`project_*`）、工作区包/CSV/Hunspell/LLM 简报导入导出、语言删除与回收站恢复、快照对比与回滚。 |
| `all` | — | 一键启用当前 `--mode` 允许的全部工具集。 |

---

## 4. 工具、资源与 Prompt 全量目录

`conlang-mcp` 共提供 **10 大领域 76 个工具**、**10 个 `conlang://` 资源模板**与 **4 个引导式 Prompt**。

### 4.1 系统与语系管理（14 个工具）

| 工具名 | 权限 | 工具集 | 功能说明 |
|-------|-----|-------|---------|
| `server_info` | 只读 | `core` | 返回服务版本、当前权限模式、已启用工具集、默认语系与锁状态。 |
| `family_list` | 只读 | `core` | 列出 `registry.json` 中注册的全部语系（含 `family_id`、路径、激活标记、`registry_revision` 与文件完整性）。 |
| `family_get_tree` | 只读 | `core` | 返回语系谱系树、工作区 `revision`、各语言词条数、自有字体状态与实际生效字体归属。 |
| `language_fork` | 写入 | `evolution` | 从父语言派生子语言（复制音系、语法、保留相同 `entry_id` 的演化词典与语料，初始化空 SCA）。 |
| `language_update` | 写入 | `evolution` | 重命名语言或调整 `parent_id`（内置环路检测，并报告字体与字形标注继承变化）。 |
| `language_delete` | 破坏性 | `admin` | 在项目事务中将无子语言的叶节点移入 `.conlang-maker/trash/<trash_id>/` 回收站，返回 `trash_id`。 |
| `language_trash_list` | 只读 | `core` | 列出项目回收站中的已删除语言及其原路径、原父语言与删除时间。 |
| `language_restore` | 破坏性 | `admin` | 按 `trash_id` 从回收站恢复语言目录与 `.conlang` 条目（校验父语言、ID/路径冲突与版本，支持 `dry_run`）。 |
| `family_register` | 写入 | `admin` | 在注册表锁与 CAS 保护下将现有 `.conlang` 项目注册到 `registry.json`。 |
| `family_unregister` | 写入 | `admin` | 从 `registry.json` 移除语系记录（不删除磁盘上的工作区文件）。 |
| `family_set_active` | 写入 | `admin` | 切换 `registry.json` 中的默认激活语系。 |
| `project_create` | 写入 | `admin` | 创建全新 Conlang Maker 工作区目录与初始根语言，可选自动注册。 |
| `project_copy` | 写入 | `admin` | 在源项目一致锁快照下将工作区完整克隆到新目录。 |
| `lexicon_migrate_inherited_links` | 写入 | `evolution` | 修复旧版派生词条缺失的 `parent_entry_id` / `source_language_id` 词源链接（支持 `dry_run`）。 |

### 4.2 音系与正字法映射（11 个工具）

| 工具名 | 权限 | 工具集 | 功能说明 |
|-------|-----|-------|---------|
| `phono_get` | 只读 | `core` | 按节读取音系（`inventory`、`romanization`、`phonotactics`、`tones`、`allophony`、`glyph_annotations`），同时返回 `local_config` 与继承解析后的 `effective_config`。 |
| `romanization_get` | 只读 | `core` | 读取罗马音映射表，并附带每条规则的字符拆分、Unicode 码位、NFD 展开、多字符标记与音素表归属分析。 |
| `romanization_analyze` | 只读 | `compute` | 执行 6 项正字法健康检查：不可达音素、不在音素表内的产出、同输入冲突规则、完全重复规则、被遮蔽规则、大小写覆盖缺口。 |
| `phono_to_ipa` | 只读 | `compute` | 单个或批量（≤ 500）将罗马音转换为音位 `/…/` 与表层 `[…]` IPA，可选返回逐段匹配与音位变体 `trace`。 |
| `phono_tokenize` | 只读 | `compute` | 按当前音素表对 IPA 字符串执行贪婪音素切分。 |
| `phono_update` | 写入 | `write` | 按节更新本地音系配置 `local_config`（支持替换或补丁合并、`dry_run` 与自动旧版书写字段归档）。 |
| `romanization_upsert_rules` | 写入 | `write` | 批量新增或修改正字法规则（可选附带 `regenerate_ipa` 词典重算预览）。 |
| `romanization_delete_rules` | 写入 | `write` | 按 `rule_id` 批量删除正字法规则。 |
| `romanization_map_upsert` | 写入 | `write` | 新建、重命名、设为唯一默认映射表或删除映射表。 |
| `phono_presets_list` | 只读 | `core` | 列出内置音系预设模板。 |
| `phono_apply_preset` | 写入 | `write` | 将内置音系预设应用到指定语言（支持 `dry_run`）。 |

### 4.3 字体与书写系统（11 个工具）

| 工具名 | 权限 | 工具集 | 功能说明 |
|-------|-----|-------|---------|
| `font_list` | 只读 | `core` | 列出全语系每门语言的字体状态（`own` 自有、`inherited` 继承祖先、`none` 无字体）、实际字体归属者与文件 SHA-256。 |
| `font_inspect` | 只读 | `core` | 解析语言当前生效字体：归属信息、字族名/版本、字形总数、压缩 `cmap` 区间、Unicode 区块分布与 `GSUB`/`GPOS` 特性标签。 |
| `font_shape` | 只读 | `audit` | 使用 HarfBuzz 对样本文本执行真实排版（默认与 GUI `.conlang-script` 一致），输出 `gid`、字形名、cluster、原文码点区间与 `.notdef` 检测。 |
| `font_audit_coverage` | 只读 | `audit` | 单语言全量字体覆盖与连字/上下文排版审计（横跨正字法、词典、语料、声调四大来源）。 |
| `font_audit_family` | 只读 | `audit` | 整棵语系树（或子树）覆盖矩阵审计：按字体 SHA-256 去重复用分析，汇总每门语言缺口与全语系并集缺口 `union_missing`。 |
| `font_import` | 写入 | `write` | 校验（≤ 20 MB、魔数、HarfBuzz 可加载且 `cmap` 非空）并导入 `.ttf`/`.otf` 字体，自动清理旧扩展名副本并生成快照。 |
| `font_import_batch` | 写入 | `write` | 在单个项目事务内为多门分支语言原子更新字体（`dry_run` 输出每门语言新旧字体及覆盖率前后对比）。 |
| `font_clear` | 写入 | `write` | 快照后移除语言自有字体，使其恢复继承祖先语言字体。 |
| `glyph_annotations_upsert` | 写入 | `write` | 新增或更新本地字符参考标注（`codepoint`、`label`、`kind`、`phonemes`）。 |
| `glyph_annotations_delete` | 写入 | `write` | 按码位删除本地字符参考标注。 |
| `glyph_annotations_sync_parent` | 写入 | `write` | 将父语言的字形参考标注同步复制到当前语言本地配置。 |

### 4.4 词典管理与演化（11 个工具）

| 工具名 | 权限 | 工具集 | 功能说明 |
|-------|-----|-------|---------|
| `lex_search` | 只读 | `core` | 多维检索词条（拼写/释义/定义/例句/标签，支持前缀、精确、子串、正则及 `ipa_fuzzy` 音近搜索），支持词性/词源筛选、排序、分页与字段裁剪。 |
| `lex_get` | 只读 | `core` | 按 `entry_id` 列表或精确拼写读取完整词条，可选附带父语言同源词对比（`with_parent: true`）。 |
| `lex_stats` | 只读 | `compute` | 统计词汇总量、词性分布、音素频率与音节长度分布。 |
| `lex_quality_check` | 只读 | `compute` | 运行词典质量检查（缺失词性、拼写含未映射字符、空 IPA、违反音位配列、缺少必填项、重复词形）。 |
| `lex_upsert` | 写入 | `write` | 批量新建或更新词条（≤ 500）：自动补齐 ID/时间戳、自动按音系计算 IPA、自动跨桶搬移与排序，保留未知扩展字段，全量校验无静默丢词。 |
| `lex_delete` | 写入 | `write` | 快照后按 `entry_id` 批量删除词条。 |
| `lex_regenerate_ipa` | 写入 | `write` | 正字法或音位变体修改后，批量重算所有未开启手动覆盖词条的 IPA（支持 `dry_run` 预览变更列表）。 |
| `lex_parent_diff` | 只读 | `evolution` | 预演父子语言间的 Pull Sync 差异（套用子语言 SCA 后的新增、待更新与双方冲突明细）。 |
| `lex_pull_sync` | 写入 | `evolution` | 快照后对全部或指定 `entry_id` 执行父语言同步演化。 |
| `lex_borrow` | 写入 | `evolution` | 从同语系其他语言借入词条（标记 `borrowed` 并记录来源语言与原词条 ID）。 |
| `lex_import_csv` | 写入 | `admin` | CSV 词表列映射预览（`dry_run`）与批量事务导入。 |

### 4.5 造词生成器（2 个工具）

| 工具名 | 权限 | 工具集 | 功能说明 |
|-------|-----|-------|---------|
| `wordgen_generate` | 只读 | `compute` | 按音位配列、音节模板、黑名单与元音和谐生成候选新词（选定后通过 `lex_upsert` 入库）。 |
| `wordgen_swadesh_gaps` | 只读 | `compute` | 对照核心 Swadesh 词表，找出当前词典尚未覆盖的基础概念缺口。 |

### 4.6 语法与翻译沙盒（7 个工具）

| 工具名 | 权限 | 工具集 | 功能说明 |
|-------|-----|-------|---------|
| `gram_get` | 只读 | `core` | 按节读取语法配置（`typology`、`syntax`、`pos`、`inflection`、`derivation`、`chapters`）。 |
| `gram_inflect` | 只读 | `compute` | 按词条或词形执行类型学感知的屈折变形，返回表层词形与命中的词缀/槽位/变位类规则。 |
| `gram_paradigm` | 只读 | `compute` | 生成指定词条在多个语法维度组合下的完整变位/变格表。 |
| `gram_derive` | 只读 | `compute` | 按派生构词规则批量预览派生词形。 |
| `gram_analyze_typology` | 只读 | `compute` | 基于当前语法规则统计并评估形态类型学指标（综合度、融合度等）。 |
| `sandbox_translate` | 只读 | `compute` | 调用翻译沙盒管线：执行词汇匹配、形态屈折与句法语序重排（SVO/SOV/VSO 等）。 |
| `gram_update` | 写入 | `write` | 按节更新语法配置（支持 `expected_revision` 与 `dry_run`）。 |

### 4.7 历时音变引擎 SCA（6 个工具）

| 工具名 | 权限 | 工具集 | 功能说明 |
|-------|-----|-------|---------|
| `sca_get` | 只读 | `core` | 读取语言的音变规则集（支持字符模式与区别特征模式）。 |
| `sca_simulate` | 只读 | `compute` | 对给定词表或整部词典模拟音变推演（支持传入尚未保存的临时规则集并返回逐步演化日志）。 |
| `sca_parse_rules_text` | 只读 | `compute` | 将纯文本音变规则语法解析为结构化规则，逐行报告语法错误。 |
| `sca_feature_query` | 只读 | `compute` | 查询满足特定语音特征表达式（如 `[+voiced, -stop]`）的音素集合。 |
| `sca_update` | 写入 | `write` | 更新音变规则集（支持结构化 JSON 或纯文本规则输入）。 |
| `sca_export_rules_text` | 只读 | `compute` | 将结构化音变规则集导出为可往返解析的纯文本格式。 |

### 4.8 语料库与自动标注（5 个工具）

| 工具名 | 权限 | 工具集 | 功能说明 |
|-------|-----|-------|---------|
| `corpus_list` | 只读 | `core` | 读取 `corpus_index.json` 语料列表与元数据。 |
| `corpus_get` | 只读 | `core` | 读取单篇语料原文与逐行莱比锡行间注释（支持按行分页）。 |
| `corpus_save` | 写入 | `write` | 在同一项目事务中原子保存语料正文并同步更新 `corpus_index.json`。 |
| `corpus_delete` | 破坏性 | `admin` | 快照后删除指定语料并同步清理索引（需 `confirm: true`）。 |
| `corpus_auto_gloss` | 只读 / 写入 | `compute` / `write` | 基于词典与形态规则自动生成行间标注；默认 `apply: false` 仅预览，传 `apply: true` 时写入。 |

### 4.9 导入与导出（5 个工具）

| 工具名 | 权限 | 工具集 | 功能说明 |
|-------|-----|-------|---------|
| `export_llm_brief` | 只读 | `admin` | 生成适合投喂给大语言模型的 Markdown 语言参考简报（可按章节筛选）。 |
| `export_workspace_bundle` | 写入 | `admin` | 将整个工作区（含自定义字体资产）原子导出为便携工作区包。 |
| `export_csv` | 写入 | `admin` | 将词典导出为带 UTF-8 BOM 的 CSV 文件。 |
| `export_dic` | 写入 | `admin` | 导出 Hunspell 拼写检查 `.dic` 与 `.aff` 词典文件。 |
| `import_workspace_bundle` | 破坏性 | `admin` | 先创建完整项目级快照，再通过单个项目事务原子导入工作区包（需 `confirm: true`）。 |

### 4.10 快照与回滚（4 个工具）

| 工具名 | 权限 | 工具集 | 功能说明 |
|-------|-----|-------|---------|
| `snapshot_list` | 只读 | `core` | 列出语言级与项目级快照（含已移除语言的转存历史），显示 `scope`、`origin`、`level` 与 `restored_from`。 |
| `snapshot_create` | 写入 | `write` | 手动创建指定范围的语言级快照（`lexicon` / `phonology` / `grammar` / `sca` / `corpus` / `font`）或项目级快照（`project`）。 |
| `snapshot_diff` | 只读 | `admin` | 对比指定快照与当前磁盘状态的文件、词条及语言树拓扑差异。 |
| `snapshot_rollback` | 破坏性 | `admin` | 非破坏性回滚快照（需 `confirm: true`）：先保护当前状态并生成恢复记录，仅还原目标 `scope`，保留其余快照历史不断裂。 |

### 4.11 内置只读资源（10 个 `conlang://` URI）

| 资源 URI 模板 | MIME 类型 | 内容说明 |
|--------------|----------|---------|
| `conlang://families` | `application/json` | 已注册语系列表。 |
| `conlang://{family_id}/tree` | `application/json` | 语系谱系树与字体继承概览。 |
| `conlang://{family_id}/{language_id}/brief` | `text/markdown` | 语言全景 Markdown 简报（适合作为长期对话背景挂载）。 |
| `conlang://{family_id}/{language_id}/phonology` | `application/json` | 本地与继承生效的音系配置。 |
| `conlang://{family_id}/{language_id}/romanization` | `application/json` | 正字法映射表及派生 Unicode 信息。 |
| `conlang://{family_id}/{language_id}/grammar` | `application/json` | 完整语法配置。 |
| `conlang://{family_id}/{language_id}/sca` | `application/json` | 历时音变规则集。 |
| `conlang://{family_id}/{language_id}/font` | `application/json` | 当前生效字体结构摘要（`cmap`、字形数、`GSUB`/`GPOS` 特性）。 |
| `conlang://{family_id}/{language_id}/lexicon/{entry_id}` | `application/json` | 单条词典词条完整记录。 |
| `conlang://{family_id}/{language_id}/corpus/{corpus_id}` | `application/json` | 单篇语料全文与行间注释。 |

### 4.12 内置引导 Prompt（4 个工作流）

| Prompt 名称 | 参数 | 引导流程 |
|------------|-----|---------|
| `audit_font_coverage` | `language`（或 `root`） | 执行字体覆盖审计 -> 归类缺字、未合字多字符序列与残留拉丁字形 -> 输出待补字形与 `.fea` OpenType 规则清单。 |
| `review_romanization` | `language` | 调用 `romanization_get` + `romanization_analyze` -> 交叉核对音素表与词典 -> 给出不可达音素、规则遮蔽与歧义修复建议。 |
| `design_sound_changes` | `parent`、`child`（或 `language`） | 读取父子音系与现有规则 -> 用 `sca_simulate` 在真实词表上迭代试跑 -> 确认后写入规则集。 |
| `lexicon_cleanup` | `language` | 运行 `lex_quality_check` -> 按问题分组 -> 用 `lex_upsert(..., dry_run: true)` 预览批量修复 -> 确认后安全提交。 |

---

## 5. 完整实战示例 —— 自造字字体覆盖审计

当你为一门或一整棵语系设计自造字字体（特别是依赖 OpenType `liga` / `calt` / `ccmp` 将拉丁正字法拼写替换为自造字字形的方案）时，靠肉眼在界面里抽查极易漏掉生僻二合字母、变音组合符或误用祖先字体的分支语言。

下面演示如何用 `conlang-mcp` 在几秒内完成全语系字体覆盖闭环。

### 第一步：摸清全语系字体归属（`font_list`）

让 AI 先调用 `font_list`（或直接触发 `audit_font_coverage` Prompt）：

- 系统沿 `parent_id` 向上查找首个 `font.otf` 或 `font.ttf`，将每门语言标记为：
  - **`own`**（自有字体）：当前语言目录拥有独立字体文件。
  - **`inherited`**（继承祖先）：当前语言未放置自有字体，回退使用祖先语言字体——一眼就能发现哪些分支方言还没替换成专属字体变体。
  - **`none`**（无可用字体）：自身与祖先均无字体（审计时返回 `NO_FONT` 并列出完整祖先链）。
- 同时返回每个字体文件的 **SHA-256 哈希**，自动识别多门分支共用完全相同字体二进制的情况。

### 第二步：检查字体表与 OpenType 特性（`font_inspect`）

对目标语言调用 `font_inspect`，核实编译产物中包含的字形总数、压缩 `cmap` 码位区间、Unicode 区块统计，以及实际编译进 `GSUB` / `GPOS` 的特性标签（如 `ccmp`、`liga`、`calt`、`mark`、`mkmk`）。

### 第三步：运行单语言或全语系覆盖审计（`font_audit_coverage` / `font_audit_family`）

`conlang-mcp` 自动从 **`romanization`（映射规则）**、**`lexicon`（有效词条）**、**`corpus`（语料正文与分词）**、**`tones`（声调标记）** 四个来源提取真实用字需求（自动剔除上下文中的 `V`、`C`、`#` 等音类宏占位符），执行两层深度检查：

#### 第一层：字符级（`cmap`）覆盖分类

| 状态 | 含义与修复建议 |
|-----|--------------|
| `covered` | 字符对应的 Unicode 码位直接存在于字体 `cmap` 中。 |
| `missing` | 码位及 NFD 拆解均不在 `cmap` 中，渲染必然出现豆腐块（`.notdef`）；报告会精确列出受影响的规则 `rule_id`、示例词条与语料出现次数。 |
| `decomposed_only` | **告警**：预组字符（如 `ā` `U+0101`）不在 `cmap` 中，但其 NFD 拆解（`a` + 组合长音符 `U+0304`）均存在。实际显示依赖输入归一化方式与 `mark` 锚点定位，建议补充预组码位或 `ccmp` 规则。 |
| `case_missing` | 字母大小写仅覆盖了其中一侧，且缺失的那一侧在规则、词典或语料中确实被使用。 |

#### 第二层：OpenType 连字与排版检查（`shaping: true`）

即使所有单字符都在 `cmap` 里，自造字字体仍可能因为漏写替换规则而渲染错误。开启 `shaping: true` 后，HarfBuzz 按与桌面端 `.conlang-script` 完全一致的默认排版参数逐条检验多字符序列与真实词形：

| 排版诊断项 | 含义与排查方向 |
|-----------|--------------|
| `substituted_to_ligature` | 多字符规则（如 `ch -> tʃ`）排版后的 glyph ID 序列与逐字符独立排版不同（例如成功合字为 `c_h`）。仅发生 `GPOS` 字距/锚点位移而未改变字形 ID 的情况会单独归类为 `positioning_only`。 |
| `unsubstituted_sequence` | 单字符均在 `cmap` 中，但多字符序列（如二合字母 `sh`）排版后仍原样输出单字母 glyph 序列，说明字体缺少对应的 `sub s h by s_h;` 等连字/上下文替换规则。 |
| `residual_glyph_matched` | 词条或语料排版后的输出字形名命中了 `residual_glyph_pattern`（例如 `^roman\.` 命中 `roman.x`），精准揪出“为了回退显示放进了 `cmap`、但忘记在 `GSUB` 中替换为自造字字形”的残留拉丁占位符。 |
| `notdef_produced` | 真实词条或语料行排版产出了 `gid = 0`（`.notdef`），直接定位渲染破损词条。 |
| `not_evaluated` | 当未配置残留字形正则或生产字体剥离了 `post` 表字形名时，明确标记对应子项为 `not_evaluated` 并说明原因，绝不把“无法判断”伪装成“0 问题通过”。 |

### 第四步：单点排障与批量换新（`font_shape` + `font_import_batch`）

1. 用 `font_shape` 针对问题词条查看每个输出 glyph 的 `gid`、字形名、位移与原文码点映射区间；搭配 `romanization_analyze` 排查词典中是否存在任何规则都匹配不到的拼写字符（`unmapped_spellings`）。
2. 重新编译各分支字体后，先用 `font_import_batch(..., dry_run: true)` 对比每门语言**旧字体 -> 新字体**的覆盖率变化，确认无误后再正式提交，一个项目事务即可原子完成快照与多分支字体替换。

---

## 6. 快照、语言回收站与非破坏性回滚

### 自动快照策略

无论是 GUI 还是 `conlang-mcp`，在执行高影响写入前都会自动保存原始字节与文件/目录存在状态：

- **强制自动快照触发条件**：单次批量写入 **≥ 20 条**、任何删除操作（词条/语料/语言）、任何字体导入/清除、`lex_pull_sync` 同步、`import_workspace_bundle` 整包导入、语言派生与改父。
- **会话首次写入保护**：小规模单条修改在每次 MCP 会话中首次触及某门语言的某个数据域时，也会自动建立基线快照。
- **双层快照粒度**：单语言修改写入 `<lang>/.oplog/snap_<id>/`（按 `lexicon` / `phonology` / `grammar` / `sca` / `corpus` / `font` 分域）；跨语言批量修改、派生、改父、删除/恢复与整包导入写入 `<project>/.conlang-maker/snapshots/snap_<id>/` 项目级快照。

### 非破坏性回滚与语言回收站

- **非破坏性 `snapshot_rollback`**：回滚操作本身会先为当前状态建立新恢复点，再仅还原目标 `scope`（例如原本无自有字体时准确恢复为无自有字体），并记录 `restored_from`，**绝不清空其他历史快照**——交错创建的词典快照 `S1` 与音系快照 `S2` 可以各自独立回滚。若项目回滚移除了新建语言目录，该语言的 `.oplog` 历史会自动转存至 `.conlang-maker/snapshots/archived_languages/`，依然可查询、可恢复。
- **语言回收站（`language_delete` / `language_restore`）**：删除叶语言不会直接永久抹除文件，而是在项目事务中将语言目录移入 `<project>/.conlang-maker/trash/<trash_id>/data/`；随时可通过 `language_trash_list` 查看，并用 `language_restore`（支持 `dry_run` 冲突预演）原样恢复。
- **桌面端可视化管理**：你也可以随时在 Conlang Maker 桌面端的 **快照与项目恢复面板** 中查看来源（`GUI` / `MCP`）、预览差异并一键恢复快照或回收站语言。

---

## 7. 常见问题排查（FAQ）

### 为什么遇到 `CONFLICT` 错误（或桌面端弹出冲突提示）？

为了防止 AI 与桌面端互相静默覆盖，所有写入均启用 `expected_revision` 版本核验：

- **AI 客户端收到 `CONFLICT`**：说明目标文件在读取后已被修改。让 AI 重新读取最新版本（或重新执行 `dry_run: true` 获取最新 `base_revisions`），生成新的 `operation_id` 再提交即可。
- **桌面端弹出冲突对话框**：当外部修改到达且你在同一模块恰好有未保存草稿时，桌面端会暂停该模块自动保存并提供三种选择：**保留本地**（查看最新磁盘差异后基于最新磁盘版本覆盖保存）、**采用磁盘**（放弃本地未保存草稿并加载磁盘新内容）、**查看差异**。若本地无未保存草稿，桌面端会自动静默刷新。

### 遇到 `LOCKED` 怎么办？

`LOCKED` 表示等待项目协调锁 `<project>/.conlang-maker/lock/` 超过 **5 秒**（通常另一项大批量写入正在提交）。稍候片刻重试即可；若前序进程异常崩溃，**请勿在程序运行期间手动删除整个 `lock` 目录**——Rust 与 `conlang-mcp` 会根据 owner 文件名中的主机标识与 PID 自动安全回收已退出的本机残留锁。

### 为什么提示 `NO_FONT`？

表示目标语言及其 `parent_id` 祖先链上均未找到 `font.otf` 或 `font.ttf`。请查看错误 `details` 中的 `ancestor_chain`，在桌面端书写页或通过 `font_import` 为祖语或当前语言导入字体后再执行审计。

### 为什么写入报 `READ_ONLY` 或 `DESTRUCTIVE_DISABLED`？

- **`READ_ONLY`**：客户端以默认只读模式启动了服务，或 `--toolsets` 未包含 `write` / `evolution` / `admin`。请在客户端配置中调整 `--mode write` 与 `--toolsets` 后重连服务。
- **`DESTRUCTIVE_DISABLED`**：`snapshot_rollback`、`language_delete`、`language_restore`、`corpus_delete`、`import_workspace_bundle` 需要同时满足启动参数 `--mode write+destructive` 以及调用参数 `"confirm": true`。

### 遇到 `AMBIGUOUS` 歧义错误如何解决？

当多个语系或语言同名（例如同一语系从备份目录重复注册进 `registry.json`）时，按名称寻址会返回 `AMBIGUOUS` 并在 `details.candidates` 中列出所有候选条目。改用唯一的 `family_id`、`language_id` 或完整路径即可精确指定。

### 在哪里查看 MCP 操作审计日志？

每一次成功提交的写入操作都会按 `operation_id` 幂等记录在 `<project>/.conlang-maker/mcp_audit.ndjson` 中；你也可以直接打开 Conlang Maker 桌面端的 **MCP 设置** 页面，直观浏览最近 50 条审计记录。
