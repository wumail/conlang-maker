#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Conlang Maker — macOS 一键安装脚本
#
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/wumail/conlang-maker/main/scripts/install.sh | bash
#
# 功能：
#   1. 自动检测架构 (arm64 / x86_64)
#   2. 下载最新 DMG
#   3. 挂载 → 复制到 /Applications → 卸载
#   4. 自动移除 quarantine 隔离属性
# ─────────────────────────────────────────────────────────────

set -euo pipefail

APP_NAME="conlang-maker"
REPO="wumail/conlang-maker"
MOUNT_POINT="/Volumes/${APP_NAME}"

# ── Helpers ──

info()  { echo "ℹ️  $*"; }
ok()    { echo "✅ $*"; }
err()   { echo "❌ $*" >&2; }
step()  { echo ""; echo "── $* ──"; }

# ── Detect architecture ──

ARCH=$(uname -m)
case "$ARCH" in
  arm64)  DMG_SUFFIX="aarch64.dmg" ;;
  x86_64) DMG_SUFFIX="x64.dmg" ;;
  *)
    err "不支持的架构 / Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

# ── Fetch latest release tag ──

step "检测最新版本 / Detecting latest version"

LATEST_TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep '"tag_name"' | head -1 | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')

if [ -z "$LATEST_TAG" ]; then
  err "无法获取最新版本号 / Failed to detect latest version"
  exit 1
fi

VERSION="${LATEST_TAG#v}"
DMG_NAME="${APP_NAME}_${VERSION}_${DMG_SUFFIX}"
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${LATEST_TAG}/${DMG_NAME}"

info "最新版本 / Latest version: ${LATEST_TAG}"
info "下载地址 / Download URL: ${DOWNLOAD_URL}"

# ── Download ──

step "下载 DMG / Downloading DMG"

TMPDIR_DL=$(mktemp -d)
DMG_PATH="${TMPDIR_DL}/${DMG_NAME}"

curl -fSL --progress-bar -o "$DMG_PATH" "$DOWNLOAD_URL"
ok "下载完成 / Download complete"

# ── Mount & Install ──

step "安装应用 / Installing app"

# Unmount if already mounted
if [ -d "$MOUNT_POINT" ]; then
  hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
fi

hdiutil attach "$DMG_PATH" -quiet -nobrowse -mountpoint "$MOUNT_POINT"

if [ -d "/Applications/${APP_NAME}.app" ]; then
  info "检测到旧版本，正在替换... / Replacing existing version..."
  rm -rf "/Applications/${APP_NAME}.app"
fi

cp -R "${MOUNT_POINT}/${APP_NAME}.app" "/Applications/"
ok "已安装到 /Applications/${APP_NAME}.app"

hdiutil detach "$MOUNT_POINT" -quiet
rm -rf "$TMPDIR_DL"

# ── Remove quarantine ──

step "移除隔离属性 / Removing quarantine attribute"

sudo xattr -rd com.apple.quarantine "/Applications/${APP_NAME}.app" 2>/dev/null || true
codesign --force --deep --sign - "/Applications/${APP_NAME}.app" 2>/dev/null || true
ok "隔离属性已移除 / Quarantine attribute removed"

# ── Done ──

echo ""
echo "============================================"
echo "  🎉 安装完成！/ Installation complete!"
echo "  打开方式 / To open:"
echo "    open /Applications/${APP_NAME}.app"
echo "============================================"
echo ""
