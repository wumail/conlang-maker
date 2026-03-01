# Conlang Maker

人工语言全流程创作工具 — 从音系设计到语法建模，从词典管理到语系派生。

📖 **[在线文档](https://wumail.github.io/conlang-maker/)**

## 特性

- 🔊 **交互式 IPA 音系设计** — 329 个音素音频，12 种语言风格预设
- 📖 **智能词典管理** — IPA 自动生成、拼接式 TTS、多义项与词源追踪
- 📝 **完整语法建模** — 6 种形态操作、条件屈折、派生引擎、范式矩阵
- 🧪 **翻译沙盒** — 标签屈折与句法重排，实时验证语法规则
- 🔬 **造词生成器** — 基于音位配列自动生成、Swadesh 100 映射
- 🌳 **语系树** — 子语言派生、拉取同步、借词管理
- 🔬 **历时音变引擎** — 字符模式与特征模式，模拟语言演变
- 📊 **语料库** — 莱比锡标注规范的行间注释
- 📤 **多格式导出** — PDF / Excel / Hunspell / CSV / LLM Prompt

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
