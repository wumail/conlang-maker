# Conlang Maker

人工语言全流程创作工具 — 从音系设计到语法建模，从词典管理到语系派生。

<image src="public/raven512x512.png" width="64"/>

📖 **[在线文档](https://wumail.github.io/conlang-maker/)**

## 特性

- 🔊 **交互式 IPA 音系设计** — 329 个离线音素音频、12 种语言风格预设、实时罗马音静态诊断与 5 种重音模式
- ✒️ **自造字书写系统** — OpenType `.ttf`/`.otf` 字体导入与语系继承、HarfBuzz 真实排版、字形基准线标尺与几何异常诊断
- 📖 **高密度词典与概念库** — 自动 IPA、表格编辑弹窗（支持 TSV 粘贴）、158 项 CLDF/Concepticon 核心概念与自定义概念、可点击词源追溯链与 10 维质检
- 📝 **统一形态与语法引擎** — 六步确定性推导管线（不规则覆盖 → 变位类 → 融合特征/优先级 → 冲突诊断 → 形态音位 `+` 边界规则 → 重音与 IPA）与逐步推导面板
- 🧪 **递归短语树翻译沙盒** — 支持标签屈折、主宾格/作通格句法对齐与递归名词短语/介词短语线性化，实时渲染本族文字
- 🌳 **语系演化与同源词矩阵** — 子语言派生、词典与语法词缀拉取同步、跨项目借词快照、全语系同源词矩阵弹窗
- 🔬 **历时音变引擎 (SCA)** — 字符模式、区别特征模式与超音段规则，支持单行规则 DSL 双向编辑与规则集导入导出
- 📊 **非破坏性莱比锡语料工作台** — 三种自动标注范围（仅补空缺 / 重算机器结果 / 重算选中行）、`verified` 人工锁定、同句快速收词抽屉与反向索引
- 📤 **出版级导出与备份** — 自包含参考语法书（HTML 嵌字 / Typst）、双向词典、PDF、Excel、Hunspell `.dic/.aff`、CSV、LLM Prompt 与完整工作区包备份
- 🤖 **内置 MCP 服务端 (`conlang-mcp`)** — Streamable HTTP 与 stdio 双模式、84 个语义工具、CAS 乐观锁与多文件原子事务，支持与桌面端实时安全协作
- ⚡ **全局效率体验** — `⌘K` / `Ctrl+K` 命令面板（跨语言检索 + `=` 即时演算）、跨模块合并型撤销/重做（`⌘Z`）与语言视图记忆恢复

## 安装

### macOS（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/wumail/conlang-maker/main/scripts/install.sh | bash
```

### 手动安装

从 [Releases](https://github.com/wumail/conlang-maker/releases) 下载对应平台的安装包。

macOS 用户首次打开如提示"应用已损坏"，请执行：

```bash
sudo xattr -rd com.apple.quarantine "/Applications/conlang-maker.app"
codesign --force --deep --sign - "/Applications/conlang-maker.app"
```

详见 [安装指南](https://wumail.github.io/conlang-maker/guide/installation.html)。

## 开发

```bash
bun install
bun run tauri dev
```

### 文档开发

```bash
bun run docs:dev     # 启动文档开发服务器
bun run docs:build   # 构建文档
```

## CI / Release

- [CI](.github/workflows/ci.yml) — TypeScript + Rust 检查
- [Release](.github/workflows/release-tauri.yml) — 多平台构建发布
- [Docs](.github/workflows/deploy-docs.yml) — 文档自动部署到 GitHub Pages
