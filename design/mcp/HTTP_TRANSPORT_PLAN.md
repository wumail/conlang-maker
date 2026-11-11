# conlang-mcp HTTP 传输改造执行方案

> 状态：方案已确认，待执行（2026-11-11）。
> 本文是交给执行模型的完整任务说明。按阶段顺序做，每个任务做完都要跑对应的验收命令，不通过不要进入下一步。

## 0. 已确认的决策

| # | 决策 | 结论 |
| --- | --- | --- |
| D1 | GUI 关闭后服务是否继续运行 | **不继续**。服务由 GUI 启动，GUI 退出时停止；不做登录自启。GUI 崩溃时由服务端 `--parent-pid` 看门狗自行退出 |
| D2 | 默认端口 | `43117`，可在设置页修改 |
| D3 | 令牌 | 每个 Agent 一个令牌，每个令牌可单独配置权限模式、工具集、默认语系，可启用/停用 |
| D4 | 令牌存储 | 明文存在只有本人可读写（0600）的 `mcp-server.json` 中，设置页可随时再次复制 |
| D5 | stdio | 保留为后备（`conlang-mcp` 不带 `serve` 子命令时即 stdio，行为与现在相同） |

PRD 中决策 Q7（"本期不做 HTTP"）、§3.4、§10 需要按本方案更新（见阶段 D）。

## 1. 现状（执行前请先核对）

- **P0 入口已修通**：`mcp/main.ts`、`mcp/server.ts` 已改用 `parseConfig` 和各领域的 `register*Tools`。`bun run mcp:check` 通过，`bun test mcp/tests` 16 个测试全过；`node scripts/build-mcp.mjs` 能编出 `src-tauri/binaries/conlang-mcp-aarch64-apple-darwin`（Mach-O 可执行文件）。过时的 JS 包 `src-tauri/binaries/conlang-mcp` 已删除。
- **已开始的改造（已通过 tsc，尚未测试，尚未接入入口）**：
  | 文件 | 状态 | 内容 |
  | --- | --- | --- |
  | `mcp/clientContext.ts` | 完成 | `AsyncLocalStorage` 保存当前调用的令牌名/令牌 id：`runWithClient()`、`currentClient()` |
  | `mcp/toolRegistry.ts` | 完成 | 工具处理函数包在 `runWithClient({clientName, tokenId})` 中执行 |
  | `mcp/storage/audit.ts` | 完成 | 写审计日志时，若条目没有 `client`，从 `currentClient()` 补上令牌名 |
  | `src/types/index.ts` | 完成 | `McpAuditLogEntry` 新增可选字段 `client` |
  | `mcp/config.ts` | 完成 | `McpConfig` 新增 `clientName`/`tokenId`；导出 `parseMode`、`parseToolsets`、`MODE_DEFAULT_TOOLSETS`；`SERVER_VERSION` 改为从 `package.json` 导入（编译后的二进制也能报告真实版本） |
  | `mcp/http/settings.ts` | 草稿完成 | 设置文件读写、默认设置生成、`SettingsWatcher`（按 mtime 重新读取）、恒定时间令牌查找、`buildConfigForToken`、`tokenGrantKey` |
  | `mcp/http/serve.ts` | 草稿，需修改 | `startHttpServer()`：Bun.serve、Host/Origin 校验、Bearer 鉴权、按会话建 `McpServer`、`/healthz`、状态文件和令牌使用时间文件、空闲会话清理 |
- **与本方案无关但仍未解决**：打开 Terrax 工作区时 GUI 闪退。之前归因到词典质检问题的结论不成立，需要单独排查（见文末）。

## 2. 文件与协议约定

所有文件都在应用数据目录（macOS：`~/Library/Application Support/com.conlang-maker/`，与 `registry.json` 同目录；TS 侧用 `getAppDataDir()`，Rust 侧用 `app.path().app_data_dir()`）。

### 2.1 `mcp-server.json`（GUI 拥有，服务端只读）

权限 0600。服务端只在文件不存在时创建（`wx`，绝不覆盖），其余时间只读，并在每次请求时按 mtime 检查是否需要重新读取。

```json
{
  "version": 1,
  "port": 43117,
  "tokens": [
    {
      "id": "tok_1a2b3c4d5e6f",
      "name": "Cursor",
      "token": "cmk_<32 字节随机数的 base64url>",
      "mode": "read-only",
      "toolsets": "default",
      "family": null,
      "enabled": true,
      "created_at": "2026-11-11T14:00:00Z"
    }
  ]
}
```

- `mode`：`read-only` | `write` | `write+destructive`。
- `toolsets`：`"default"`（按 mode 推导：只读 → `core,audit,compute`；读写 → 再加 `write,evolution`；完全权限 → `all`），或 `"all"`，或逗号分隔列表。
- `family`：该 Agent 的默认语系 `.conlang` 路径，`null` 表示动态发现。
- 令牌少于 16 个字符的条目会被服务端忽略。

### 2.2 `mcp-server.state.json`（服务端拥有，运行期存在）

服务启动时写入，正常退出时删除（只删 pid 等于自己的）。GUI 用它找到服务进程：

```json
{ "name": "conlang-maker-mcp", "pid": 12345, "port": 43117,
  "url": "http://127.0.0.1:43117/mcp", "version": "1.0.7",
  "started_at": "…", "settings_path": "…/mcp-server.json" }
```

### 2.3 `mcp-token-usage.json`（服务端拥有，持久）

`{ "token_last_used": { "tok_…": "2026-11-11T14:05:00Z" } }`，最多每 15 秒写一次。设置页用来显示"最近使用"。

### 2.4 HTTP 接口

| 路径 | 方法 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `/healthz` | GET | 无 | `{ok, name:"conlang-maker-mcp", version, pid, port, started_at, sessions}` |
| `/mcp` | POST / GET / DELETE | `Authorization: Bearer <令牌>` | MCP Streamable HTTP |
| 其他 | — | — | 404 |

所有请求都先校验：
- `Host` 必须是 `127.0.0.1:<端口>`、`localhost:<端口>` 或 `[::1]:<端口>`，否则 403；
- 如果带 `Origin`，必须是 `http://127.0.0.1:<端口>`、`http://localhost:<端口>` 或 `http://[::1]:<端口>`，否则 403；不带 `Origin` 放行（非浏览器客户端）。

鉴权和会话规则：
- 令牌缺失、错误或已停用 → 401，带 `WWW-Authenticate: Bearer realm="conlang-maker"`。
- 没有 `Mcp-Session-Id` 的 POST，且请求体是 `initialize` → 用该令牌的配置新建会话（`createServer(buildConfigForToken(base, token))`）。
- 带 `Mcp-Session-Id`：会话不存在，或会话属于别的令牌 → 404；令牌的 mode/toolsets/family/name 在 GUI 中被改过（`tokenGrantKey` 变了）→ 关闭该会话并返回 404，客户端按规范重新初始化后拿到新权限。
- 令牌被删除或停用后，下一次请求即 401。
- 请求体上限 4 MiB，超出返回 413。
- 会话空闲超过 60 分钟自动关闭。

### 2.5 命令行

```
conlang-mcp                                  # stdio（与现在一致，支持 --mode/--toolsets/--family/--registry/--allow-root）
conlang-mcp --stdio [同上参数]                # 同上，显式写法
conlang-mcp serve [--port N] [--settings PATH] [--parent-pid PID] [--registry PATH] [--allow-root DIR]
```

`serve` 的退出码：`0` 正常退出；`3` 本端口已有 conlang-mcp 在运行；`4` 端口被其他程序占用；`1` 其他错误。

---

## 阶段 P1：服务端 HTTP 模式

### T-H1 修改 `mcp/http/serve.ts`

在现有草稿上做以下修改：

1. **按实际端口计算白名单**。现在 `allowedHosts`、`allowedOrigins`、`state.port`、`state.url` 在 `Bun.serve` 之前用请求的端口算出。改为在 `Bun.serve` 成功后用 `bunServer.port` 计算，这样测试可以传 `port: 0` 让系统随机分配端口。返回值的 `port`/`url` 也用实际端口。
2. **确认端口占用的报错形态**。Bun 1.3.9 下 `Bun.serve` 端口被占时抛出的错误，`code` 是否为 `EADDRINUSE` 要写测试验证（见 T-H4 用例 12、13），必要时调整判断条件。
3. **保持 `idleTimeout: 255`**。Bun 默认 10 秒断开空闲连接，而 SDK 的 SSE 保活帧是 15 秒一次，改小会导致 SSE 被切断。
4. 不要在任何日志中输出令牌明文。

### T-H2 新增 `mcp/http/cli.ts`，并修改 `mcp/main.ts`

`mcp/http/cli.ts` 导出 `runServeCommand(argv: string[]): Promise<number>`：

1. 解析 `--port`、`--settings`、`--parent-pid`（支持 `--flag value` 和 `--flag=value`）。`--settings` 默认 `getDefaultSettingsPath()`，也接受环境变量 `CONLANG_MCP_SETTINGS`。
2. `baseConfig = parseConfig(argv)`（复用 `--registry`、`--allow-root`；mode/toolsets 在 HTTP 模式下会被每个令牌覆盖）。
3. `loadOrCreateSettings(settingsPath)`。如果是新创建的，在 stderr 打印一行提示：设置文件路径，以及"默认令牌请在设置文件或 GUI 中查看"。**不要打印令牌本身。**
4. 调用 `startHttpServer()`。捕获 `PortInUseError`：`existing` 非空 → stderr 输出"已在运行（版本、pid）"并返回 3；否则输出"端口被占用"并返回 4。
5. 启动成功后在 stderr 打印 `[conlang-mcp] v<版本> serving http://127.0.0.1:<端口>/mcp`。
6. 注册 `SIGINT`、`SIGTERM`（Windows 上额外处理 `SIGBREAK`）：调用 `stop()` 后退出码 0。
7. **父进程看门狗**：若给了 `--parent-pid`，每 2 秒执行一次 `process.kill(pid, 0)`；抛出 `ESRCH` 即父进程已不存在，调用 `stop()` 后退出。`EPERM` 视为父进程仍存在。这样 GUI 被强杀时服务也会退出（满足 D1）。

`mcp/main.ts`：

```ts
const argv = process.argv.slice(2);
if (argv[0] === "serve") {
  process.exit(await runServeCommand(argv.slice(1)));
}
// 其余情况（含 --stdio）走现有 stdio 逻辑，parseConfig 会忽略 --stdio
```

stdio 模式下 stdout 只能输出 JSON-RPC，所有日志一律用 `console.error`；serve 模式同样只用 stderr。

### T-H3 构建检查

`scripts/build-mcp.mjs` 不需要改。确认：
- `bun build --compile` 之后，`conlang-mcp serve --port 0` 能启动；`/healthz` 返回的 `version` 等于 `package.json` 的版本（验证 `import packageJson from "../package.json"` 在编译产物中生效）。
- 编译产物下字体塑形（HarfBuzz wasm）能正常工作：用 SDK 客户端调用一次 `font_shape` 或 `font_inspect`。

### T-H4 新增测试 `mcp/tests/http.test.ts`

用临时目录放 `mcp-server.json`、registry 和一个小的测试工作区（可复用 `tools-e2e.test.ts` 的夹具构造方式），`startHttpServer({ port: 0, settingsPath, statePath, usagePath, ... })` 在进程内启动。客户端用 SDK 的 `StreamableHTTPClientTransport`，通过 `requestInit: { headers: { Authorization: "Bearer …" } }` 传令牌。

必须覆盖的用例：

| # | 用例 | 期望 |
| --- | --- | --- |
| 1 | `GET /healthz` | 200，`name === "conlang-maker-mcp"`，`version` 正确 |
| 2 | 无令牌 POST initialize | 401，带 `WWW-Authenticate` |
| 3 | 错误令牌 / 已停用令牌 | 401 |
| 4 | `Host: evil.example:<端口>` | 403（Bun 的 `fetch` 可能不允许改 Host，改用 `node:net` 发原始 HTTP 请求） |
| 5 | `Origin: https://evil.example` | 403；`Origin: http://127.0.0.1:<端口>` 放行 |
| 6 | 只读令牌 `listTools` | 有 `lex_search`，没有 `lex_upsert`、`project_create` |
| 7 | 完全权限令牌 `listTools` | 76 个工具齐全（可复用 `coverage-matrix.test.ts` 的 `EXPECTED_76_TOOLS`） |
| 8 | 令牌带 `family` | `server_info` 返回的 `default_family` 等于该路径 |
| 9 | 会话中途在设置文件里把该令牌删掉 | 下一次调用 401 |
| 10 | 会话中途把令牌从只读改为读写 | 下一次调用 404；重新连接后 `listTools` 出现写工具 |
| 11 | 两个读写令牌同时 `lex_upsert` 不同词条 | 都成功；审计日志两条记录的 `client` 分别是两个令牌名 |
| 12 | 端口已被 conlang-mcp 占用时再启动 | 抛出 `PortInUseError`，`existing.version` 有值 |
| 13 | 端口被普通 `Bun.serve` 占用时启动 | 抛出 `PortInUseError`，`existing === null` |
| 14 | 状态文件 | 启动后存在且 pid 正确；`stop()` 后删除 |
| 15 | 使用时间文件 | 调用后（可把刷新间隔做成可注入参数以便测试）`mcp-token-usage.json` 中有该令牌的时间 |
| 16 | 请求体超过 4 MiB | 413 |
| 17 | 用 SDK 的 `StdioClientTransport` 启动 `bun mcp/main.ts --mode read-only` | `listTools` 正常（确认 stdio 后备没被破坏） |

再写一个进程级测试：`Bun.spawn` 启动 `bun mcp/main.ts serve --port 0 --settings … --parent-pid <一个子进程的 pid>`，结束那个子进程后，服务在 5 秒内退出。（`--port 0` 时需要从 stderr 的启动行或状态文件中读出实际端口。）

**P1 验收**：`bun run mcp:check` 通过；`bun test mcp/tests` 全部通过（原有 16 个加新增用例）；T-H3 的两项手工检查通过。

---

## 阶段 P2：GUI 托管与设置页

### T-R1 Rust：新增 `src-tauri/src/commands/mcp_server.rs`

1. **设置文件模型**：用 serde 定义与 §2.1 相同的结构（未知字段用 `#[serde(flatten)] extra: serde_json::Map` 保留，避免将来丢字段）。
2. **路径**：`app_data_dir()/mcp-server.json`、`mcp-server.state.json`、`mcp-token-usage.json`、`logs/mcp-server.log`。
3. **读写**：写入用 `utils::fs_util::atomic_write`，写完在 unix 上设置 0600（`std::os::unix::fs::PermissionsExt`）。文件不存在时创建默认设置：一个名为 "Default"、只读的令牌。**必须在启动服务进程之前创建**，避免与服务端同时创建。
4. **令牌生成**：`rand::rngs::OsRng` 生成 32 字节，`base64` crate 的 URL_SAFE_NO_PAD 编码，前缀 `cmk_`；id 为 `tok_` 加 6 字节 hex。
5. **命令**（全部注册到 `lib.rs` 的 `generate_handler!`）：
   | 命令 | 参数 | 返回 |
   | --- | --- | --- |
   | `mcp_server_get_settings` | — | 设置（含令牌明文）、`url`、各令牌最近使用时间（读 usage 文件） |
   | `mcp_server_set_port` | `port: u16` | 写入后若服务在运行则重启 |
   | `mcp_token_create` | `name, mode, toolsets, family` | 新令牌 |
   | `mcp_token_update` | `id` 加可选的 `name, mode, toolsets, family, enabled` | 更新后的令牌 |
   | `mcp_token_regenerate` | `id` | 新的令牌明文 |
   | `mcp_token_delete` | `id` | — |
   | `mcp_server_status` | — | `{ state: "running" \| "stopped" \| "starting" \| "port_in_use" \| "error", owned, pid, port, url, version, sessions, last_error, log_path }` |
   | `mcp_server_start` / `mcp_server_stop` / `mcp_server_restart` | — | 状态 |
   - mode 只接受三个合法值；toolsets 只接受 `default`、`all` 或合法工具集名的逗号列表（`core,audit,compute,write,evolution,admin`），否则返回错误。
6. **健康检查**：不新增 HTTP 依赖，用 `std::net::TcpStream` 连 `127.0.0.1:<端口>`，设置 1 秒读写超时，发 `GET /healthz HTTP/1.1\r\nHost: 127.0.0.1:<端口>\r\nConnection: close\r\n\r\n`，解析响应体 JSON。

### T-R2 Rust：进程管理

托管状态 `McpServerProcess { child: Mutex<Option<std::process::Child>>, owned: AtomicBool, last_error: Mutex<Option<String>> }`，在 `setup` 中 `app.manage(...)`。

**启动流程** `start_server(app)`：
1. 确保设置文件存在，读出端口。
2. 查 `/healthz`：
   - 正常且 `name` 正确、`version == env!("CARGO_PKG_VERSION")` → 视为运行中，`owned = false`（多半是另一个 GUI 实例启动的），不再启动新进程；
   - 正常但版本不同 → 读状态文件，**确认状态文件里的 pid 与 healthz 返回的 pid 一致**后发 SIGTERM（`libc::kill`；Windows 用 `taskkill /PID`），最多等 3 秒，再继续第 3 步；
   - 端口能连上但不是 conlang-mcp → `state = port_in_use`，记录 `last_error`，结束；
   - 连不上 → 继续第 3 步。
3. 用已有的二进制路径解析逻辑（把 `get_mcp_binary_path` 的查找部分重构成 `resolve_mcp_binary() -> Option<PathBuf>`，找不到时返回明确错误）启动：
   `Command::new(bin).args(["serve", "--settings", <路径>, "--parent-pid", &std::process::id().to_string()])`，stdin 置空，stdout 置空，stderr 追加写入 `logs/mcp-server.log`。
4. 每 100 ms 查一次 `/healthz`，最多 5 秒；期间若子进程已退出，按退出码 3/4/其他设置状态和 `last_error`（附日志最后几行）。

**停止**：只停 `owned` 的子进程：先 SIGTERM，等 2 秒，仍未退出则 `child.kill()`，然后 `wait()`。

**生命周期**（`lib.rs`）：
- 增加 `.setup(|app| { app.manage(McpServerProcess::default()); 新开线程执行 start_server，不阻塞窗口; Ok(()) })`。
- 把 `.run(tauri::generate_context!())` 改为 `.build(tauri::generate_context!()).expect(...).run(|app, event| { if matches!(event, tauri::RunEvent::Exit) { stop_owned_server(app) } })`。
- GUI 被强杀时由服务端看门狗兜底（T-H2 第 7 点）。

### T-R3 Rust：其他改动

- `models.rs` 的 `McpAuditLogEntry` 增加 `#[serde(default, skip_serializing_if = "Option::is_none")] pub client: Option<String>`。
- 保留 `get_mcp_binary_path`，供设置页的 stdio 后备片段使用。
- 单元测试：设置文件的默认创建、往返读写、0600 权限、保留未知字段；令牌格式与唯一性；healthz 响应解析（用 `TcpListener` 起一个假服务）。

**Rust 验收**：`cd src-tauri && cargo check && cargo test` 通过，且不新增编译警告。

### T-G1 前端类型与 API

`src/types/index.ts` 增加 `McpServerSettings`、`McpTokenSettings`、`McpServerStatus` 等类型，与 Rust 返回结构一致。

### T-G2 设置页改版（`src/pages/McpSettingsPage.tsx`）

页面从上到下：

1. **服务状态卡片**
   - 状态指示（运行中 / 已停止 / 启动中 / 端口被占用 / 出错），显示 URL（带复制按钮）、版本、当前会话数；
   - 启动、停止、重启按钮；
   - 端口输入框和保存按钮（保存后自动重启）；
   - 出错时显示 `last_error` 和日志文件路径；
   - 页面可见时每 3 秒轮询一次 `mcp_server_status`。
2. **访问令牌**
   - 表格列：名称、权限模式、工具集、默认语系、启用开关、最近使用时间、操作（复制令牌、重新生成、编辑、删除）；
   - 令牌默认打码显示，可切换明文；
   - "新建令牌"对话框：名称、权限模式（沿用现有三种模式的说明文案）、工具集（默认 / 全部 / 自定义多选）、默认语系（无 / 当前打开的语系 / 从已注册语系中选择）；
   - 选择完全权限时沿用现有的破坏性操作警告。
3. **客户端接入配置**（针对表格中选中的令牌生成）
   | 客户端 | 片段 |
   | --- | --- |
   | Cursor（`.cursor/mcp.json`） | `{"mcpServers": {"conlang-maker": {"url": "<URL>", "headers": {"Authorization": "Bearer <令牌>"}}}}` |
   | Claude Code（命令行） | `claude mcp add --transport http conlang-maker <URL> --header "Authorization: Bearer <令牌>"` |
   | 通用 HTTP 客户端 | URL 加请求头说明 |
   | stdio 后备（可折叠，供 Claude Desktop 等只支持 stdio 的客户端） | 沿用现有 `McpConfigSnippets` 的 `command` + `args` 生成逻辑 |
   - 原来的 "DSH 命令行" 片段里 `dsh mcp add …` 的语法从未核实，**删掉**，等确认 DSH 的 HTTP 配置方式后再加。
4. **审计日志卡片**：增加"客户端"列，显示 `client`（为空时显示 "stdio" 或 "GUI"，依据 `origin`）。

把片段生成写成纯函数（例如 `src/components/mcp/httpSnippets.ts` 中的 `buildHttpSnippets(url, token)`），配套单元测试（项目没有 vitest，`src/` 下现有的 `*.test.ts` 用 `bun test` 运行，照此写即可）。

### T-G3 多语言文案

在 `src/i18n/zh.ts` 和英文文件的 `mcp` 节点下补齐所有新文案（服务状态、令牌管理、对话框、错误提示等），删除不再使用的文案（如 `dshTitle`）。

**P2 验收**：
- `bunx tsc --noEmit`、`bun run i18n:check`、`bun test src`、`cd src-tauri && cargo test` 全部通过；
- `bun run mcp:build` 后 `bun tauri dev`，进行以下手工检查：
  1. 打开应用后设置页显示"运行中"，`curl http://127.0.0.1:43117/healthz` 正常；
  2. 复制 Cursor 片段到 Cursor，能列出工具并调用 `family_list`；
  3. 在设置页把该令牌改为只读，Cursor 再次调用时写工具消失；
  4. 删除令牌后 Cursor 调用失败（401）；
  5. 退出应用后 `lsof -iTCP:43117 -sTCP:LISTEN` 无输出；
  6. `kill -9` GUI 进程后，服务在约 3 秒内退出；
  7. 把端口改成别的值后服务在新端口运行，`mcp-server.json` 中端口已更新；
  8. 打包后的 `.app` 挪到别的目录再打开，Cursor 配置无需修改仍能连上。

---

## 阶段 D：文档

1. `design/mcp/PRD.md`：更新决策 Q7（改为 HTTP 为主、stdio 后备）、§3.4（传输与进程模型）、§10（部署与配置）。
2. `design/mcp/EXECUTION_LOG.md`：新增任务卡 T-H1 至 T-H4、T-R1 至 T-R3、T-G1 至 T-G3，记录实际验收结果。
3. `docs/zh/modules/mcp.md`、`docs/en/modules/mcp.md`：按新的设置页重写使用说明（启动方式、令牌管理、各客户端配置、stdio 后备、安全说明）。注意现有中文文件末尾有一行多余的 `EOF`，要删掉。
4. `design/mcp/DSH_SETUP.md`：改为 HTTP 配置方式，或注明待核实。

---

## 注意事项

- **不要把令牌写进日志、审计记录或报错信息。**
- `mcp-server.json` 只由 GUI 写；服务端只在文件不存在时用 `wx` 创建。
- `import packageJson from "../package.json"` 已在 `mcp/config.ts` 中使用，依赖根 `tsconfig.json` 的 `resolveJsonModule`，不要删。
- 进程内并发没有问题：`mcp/storage/lock.ts` 的 `withDirectoryLock` 自带进程内互斥队列，多个 HTTP 会话同时写会排队，跨进程（GUI 的 Rust 端）仍由锁目录保护。
- 会话因权限变化被关闭后返回 404，按 MCP 规范客户端应重新初始化。若某个客户端不会自动重连，用户手动重连即可，在文档中说明。
- Windows 上 `chmod` 不生效；看门狗用的 `process.kill(pid, 0)` 在 Windows 上可用。

## 附：闪退问题（独立任务，不在本方案范围内）

打开 Terrax 工作区时 GUI 闪退，原因尚未查明。建议排查步骤：
1. `bun tauri dev` 启动，打开该工作区，记录终端中的 Rust panic 信息（release 配置了 `panic = "abort"`，所以必须用 dev 构建看堆栈），设置 `RUST_BACKTRACE=1`；
2. 同时打开 WebView 开发者工具，查看控制台报错；
3. 若是 Rust panic，定位到具体命令（如 `load_all_words`、`watch_project`）后，用该工作区的数据写最小复现测试。
