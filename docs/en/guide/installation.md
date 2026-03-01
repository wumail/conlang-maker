# Installation

## macOS

### Option 1: Install Script (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/wumail/conlang-maker/main/scripts/install.sh | bash
```

The script will automatically download the latest release, install it to `/Applications`, and remove the macOS quarantine attribute.

### Option 2: Manual DMG Install

1. Download the `.dmg` file from [Releases](https://github.com/wumail/conlang-maker/releases)
2. Open the DMG and drag `conlang-maker.app` to `/Applications`
3. On first launch you may see an "app is damaged" error. Run these commands in Terminal:

```bash
sudo xattr -rd com.apple.quarantine "/Applications/conlang-maker.app"
codesign --force --deep --sign - "/Applications/conlang-maker.app"
```

:::tip Why is this needed?
Since the app is not signed with an Apple Developer certificate, macOS Gatekeeper blocks it from opening. The commands above remove the quarantine flag and re-sign the app, after which it will work normally.
:::

## Linux

Download the appropriate package from [Releases](https://github.com/wumail/conlang-maker/releases):

| Distribution | Format |
|-------------|--------|
| Debian / Ubuntu | `.deb` |
| Fedora / RHEL | `.rpm` |
| Universal | `.AppImage` |

### Using the Install Script

```bash
curl -fsSL https://raw.githubusercontent.com/wumail/conlang-maker/main/scripts/install.sh | bash
```

The script auto-detects your system architecture and package manager.

## Windows

Download the `.msi` or `.exe` installer from [Releases](https://github.com/wumail/conlang-maker/releases) and run it.

## Auto-Update

The app has built-in auto-update. Go to the **About** page and click **Check for Updates**. If a new version is available, you can download, install, and restart the app directly.
