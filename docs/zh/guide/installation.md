# 安装指南

## macOS

### 方法一：使用安装脚本（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/wumail/conlang-maker/main/scripts/install.sh | bash
```

脚本会自动下载最新版本、安装到 `/Applications`，并移除 macOS 隔离属性。

### 方法二：手动安装 DMG

1. 从 [Releases](https://github.com/wumail/conlang-maker/releases) 下载 `.dmg` 文件
2. 打开 DMG，将 `conlang-maker.app` 拖入 `/Applications`
3. 首次打开可能提示"应用已损坏"，请在终端执行以下命令修复：

```bash
sudo xattr -rd com.apple.quarantine "/Applications/conlang-maker.app"
codesign --force --deep --sign - "/Applications/conlang-maker.app"
```

:::tip 为什么需要这一步？
由于未购买 Apple Developer 证书，macOS Gatekeeper 会阻止直接打开。上述命令会移除隔离属性并重新签名，之后即可正常使用。
:::

## Linux

从 [Releases](https://github.com/wumail/conlang-maker/releases) 下载对应格式的安装包：

| 发行版 | 格式 |
|--------|------|
| Debian / Ubuntu | `.deb` |
| Fedora / RHEL | `.rpm` |
| 通用 | `.AppImage` |

### 使用安装脚本

```bash
curl -fsSL https://raw.githubusercontent.com/wumail/conlang-maker/main/scripts/install.sh | bash
```

脚本会自动检测系统架构和包管理器，下载并安装对应格式的安装包。

## Windows

从 [Releases](https://github.com/wumail/conlang-maker/releases) 下载 `.msi` 或 `.exe` 安装包，双击安装即可。

## 自动更新

应用内置了自动更新功能。在 **关于** 页面点击 **检查更新** 按钮，如果有新版本可用，可以直接下载安装并重启应用。
