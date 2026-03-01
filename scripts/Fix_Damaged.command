#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Conlang Maker — macOS 修复助手
# 解决 "App 已损坏" / "App is damaged" 问题
#
# 使用方法：双击此文件运行，或在终端执行：
#   chmod +x Fix_Damaged.command && ./Fix_Damaged.command
# ─────────────────────────────────────────────────────────────

APP_NAME="conlang-maker"
APP_PATH="/Applications/${APP_NAME}.app"

echo ""
echo "============================================"
echo "  Conlang Maker — macOS 修复助手"
echo "  Fix 'App is damaged' helper"
echo "============================================"
echo ""

if [ ! -d "$APP_PATH" ]; then
  echo "❌ 未找到 ${APP_PATH}"
  echo "   请先将 Conlang Maker 拖入 /Applications 文件夹。"
  echo ""
  echo "❌ ${APP_PATH} not found."
  echo "   Please drag Conlang Maker into /Applications first."
  echo ""
  read -n 1 -s -r -p "按任意键退出 / Press any key to exit..."
  exit 1
fi

echo "🔧 正在移除隔离属性... / Removing quarantine attribute..."
echo "   （需要输入开机密码 / Your login password is required）"
echo ""

sudo xattr -rd com.apple.quarantine "$APP_PATH"

if [ $? -eq 0 ]; then
  echo ""
  echo "🔧 正在重新签名... / Re-signing app..."
  codesign --force --deep --sign - "$APP_PATH" 2>/dev/null || true
  echo ""
  echo "✅ 修复成功！现在可以正常打开 Conlang Maker 了。"
  echo "✅ Fixed! You can now open Conlang Maker normally."
else
  echo ""
  echo "❌ 修复失败，请尝试手动执行以下命令："
  echo "❌ Fix failed. Please try running this command manually:"
  echo ""
  echo "   sudo xattr -rd com.apple.quarantine \"${APP_PATH}\""
fi

echo ""
read -n 1 -s -r -p "按任意键退出 / Press any key to exit..."
echo ""
