#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Conlang Maker — 打包 DMG（附带修复脚本）
#
# 使用方法：在项目根目录执行
#   bash scripts/package_dmg.sh
#
# 前置条件：先运行 bun run tauri build
# ─────────────────────────────────────────────────────────────

set -euo pipefail

APP_NAME="conlang-maker"
VERSION=$(grep '"version":' package.json | head -n 1 | awk -F: '{ print $2 }' | sed 's/[", ]//g')
DMG_NAME="${APP_NAME}_${VERSION}_ManualFix.dmg"
SRC_APP_PATH="src-tauri/target/release/bundle/macos/${APP_NAME}.app"
DIST_DIR="dist_dmg"

echo "📦 开始打包 DMG (带修复脚本)..."
echo "版本: $VERSION"

# 1. 检查构建是否存在
if [ ! -d "$SRC_APP_PATH" ]; then
    echo "❌ 错误: 未找到构建好的 App: $SRC_APP_PATH"
    echo "请先运行: bun run tauri build"
    exit 1
fi

# 2. 准备临时目录
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# 3. 复制文件
echo "复制 App..."
cp -R "$SRC_APP_PATH" "$DIST_DIR/"
echo "复制修复脚本..."
cp "scripts/Fix_Damaged.command" "$DIST_DIR/"
chmod +x "$DIST_DIR/Fix_Damaged.command"

# 4. 创建 /Applications 软链接
ln -s /Applications "$DIST_DIR/Applications"

# 5. 打包 DMG
echo "创建 DMG..."
rm -f "$DMG_NAME"
hdiutil create -volname "${APP_NAME}" -srcfolder "$DIST_DIR" -ov -format UDZO "$DMG_NAME"

# 6. 清理
rm -rf "$DIST_DIR"

echo "✅ 打包完成!"
echo "文件位置: $PWD/$DMG_NAME"
