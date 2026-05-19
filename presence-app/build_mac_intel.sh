#!/bin/bash
# Intel Mac 用ビルドスクリプト
# 事前に: pip3 install -r requirements.txt

pyinstaller \
  -y \
  --onedir \
  --windowed \
  --name IMLPresence_intel \
  --osx-bundle-identifier com.iml.presence \
  --icon icon.icns \
  presence_app.py

# Dock に表示しないよう LSUIElement を Info.plist に追記
PLIST="dist/IMLPresence_intel.app/Contents/Info.plist"
if [ -f "$PLIST" ]; then
  /usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :LSUIElement true" "$PLIST"
  echo "LSUIElement を設定しました"
fi

echo ""
echo "完了: dist/IMLPresence_intel.app"
echo "dist/IMLPresence_intel.app を /Applications にコピーして起動してください"
