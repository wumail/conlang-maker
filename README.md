# Conlang Maker

A desktop application for constructing languages (conlangs), built with Tauri + React + TypeScript.

## Installation

### macOS

**方法一：使用安装脚本（推荐）**

```bash
curl -fsSL https://raw.githubusercontent.com/wumail/conlang-maker/main/scripts/install.sh | bash
```

脚本会自动下载最新版本、安装到 `/Applications`，并移除 macOS 隔离属性。

**方法二：手动安装 DMG**

1. 从 [Releases](https://github.com/wumail/conlang-maker/releases) 下载 `.dmg` 文件
2. 打开 DMG，将 `conlang-maker.app` 拖入 `/Applications`
3. 首次打开可能提示"应用已损坏"，请在终端执行以下命令修复：

```bash
sudo xattr -rd com.apple.quarantine "/Applications/conlang-maker.app"
codesign --force --deep --sign - "/Applications/conlang-maker.app"
```

> ⚠️ 由于未购买 Apple Developer 证书，macOS Gatekeeper 会阻止直接打开。上述命令会移除隔离属性并重新 ad-hoc 签名，之后即可正常使用。

### Linux

从 [Releases](https://github.com/wumail/conlang-maker/releases) 下载对应格式的安装包：
- `.deb` (Debian/Ubuntu)
- `.rpm` (Fedora/RHEL)
- `.AppImage` (通用)

### Windows

从 [Releases](https://github.com/wumail/conlang-maker/releases) 下载 `.msi` 或 `.exe` 安装包。

## Development

### Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

### Getting Started

```bash
bun install
bun run tauri dev
```

## CI / Release

- CI workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
	- Runs on macOS / Linux / Windows
	- Executes TypeScript type-check and Rust `cargo check`
- Release workflow: [`.github/workflows/release-tauri.yml`](.github/workflows/release-tauri.yml)
	- Triggered by tag push like `v1.0.3`
	- Builds and publishes installers for macOS (aarch64 + x64) / Linux / Windows

## Auto Update (Tauri Updater)

- Updater endpoint is configured in [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json)
- Required GitHub secrets for release signing:
	- `TAURI_SIGNING_PRIVATE_KEY`
	- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `plugins.updater.pubkey` in `tauri.conf.json` must be set to your real updater public key before production release.

### Generate updater keypair

Run locally:

```bash
bunx tauri signer generate -w ~/.tauri/myapp.key
```

- Put the private key file contents into GitHub secret `TAURI_SIGNING_PRIVATE_KEY`
- Put passphrase into `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- Put the generated public key into `src-tauri/tauri.conf.json` -> `plugins.updater.pubkey`
